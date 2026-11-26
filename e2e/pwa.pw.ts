/**
 * The installable app (docs/architecture.md → Installable app) on the
 * production build: the manifest, the service worker and what it may answer,
 * the "not running" screen with the server stopped, the update flow, and no
 * worker on an origin that isn't secure.
 *
 * It runs its own server (port 4321) on a copy of `dist/`, so it can stop,
 * restart and "rebuild" it without touching the two shared e2e servers.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	type Browser,
	type BrowserContext,
	expect,
	type Page,
	test,
} from "@playwright/test";

const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = ".e2e/pwa";
const DIST = join(ROOT, "dist");
const STUDY = join(ROOT, "study");
const CONFIG = join(ROOT, "config");

let server: ChildProcess | undefined;
let cookie = { name: "", value: "" };

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
	rmSync(ROOT, { recursive: true, force: true });
	mkdirSync(join(STUDY, "general", "materials"), { recursive: true });
	mkdirSync(CONFIG, { recursive: true });
	cpSync("dist", DIST, { recursive: true });
	writeFileSync(join(STUDY, "general", "materials", "nota.md"), "# Nota\n");
	const seeded = spawnSync("bun", ["e2e/seed-device.ts", CONFIG, String(PORT)]);
	if (seeded.status !== 0) throw new Error(String(seeded.stderr));
	const [name = "", value = ""] = readFileSync(
		join(CONFIG, "e2e-cookie"),
		"utf8",
	)
		.trim()
		.split("=");
	cookie = { name, value };
	await start();
});

test.afterAll(async () => {
	await stop();
});

async function start() {
	server = spawn("bun", ["src/server/main.ts"], {
		env: {
			...process.env,
			NODE_ENV: "production",
			PORT: String(PORT),
			LEMMA_FAKE: "1",
			LEMMA_FAKE_DELAY_MS: "15",
			LEMMA_OPEN: "0",
			LEMMA_STUDY_DIR: STUDY,
			LEMMA_CONFIG_DIR: CONFIG,
			LEMMA_DIST_DIR: DIST,
		},
		stdio: "ignore",
	});
	await expect
		.poll(
			() =>
				fetch(`${BASE}/`).then(
					(r) => r.ok,
					() => false,
				),
			{
				timeout: 15_000,
			},
		)
		.toBe(true);
}

async function stop() {
	const child = server;
	server = undefined;
	if (!child || child.exitCode !== null) return;
	const exited = new Promise((resolve) => child.once("exit", resolve));
	child.kill();
	await exited;
}

/** A paired context with service workers on (the config blocks them elsewhere). */
const paired = (browser: Browser) =>
	browser.newContext({
		serviceWorkers: "allow",
		storageState: {
			cookies: [
				{
					...cookie,
					domain: "127.0.0.1",
					path: "/",
					expires: -1,
					httpOnly: true,
					secure: false,
					sameSite: "Strict",
				},
			],
			origins: [],
		},
	});

/** Every CSP violation, uncaught error and console error on the page. */
function watch(page: Page) {
	const problems: string[] = [];
	page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
	page.on("console", (m) => {
		if (m.type() === "error" || /content security policy/i.test(m.text())) {
			problems.push(`console: ${m.text()}`);
		}
	});
	return problems;
}

/** Opens the app, waits for the worker, and reloads so the worker controls the page. */
async function openControlled(context: BrowserContext) {
	const page = await context.newPage();
	const problems = watch(page);
	await page.goto(`${BASE}/`);
	await page.waitForURL(/\/s\/[\w-]+$/);
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	await page.reload();
	await expect
		.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
		.toBe(true);
	await expect(composer(page)).toBeVisible();
	return { page, problems };
}

const composer = (page: Page) => page.getByRole("textbox").first();

test("the manifest is valid and served, and the worker registers on 127.0.0.1", async ({
	browser,
}) => {
	const context = await paired(browser);
	const page = await context.newPage();
	const problems = watch(page);
	await page.goto(`${BASE}/`);

	const href = await page.locator('link[rel="manifest"]').getAttribute("href");
	expect(href).toBe("/manifest.webmanifest");
	const res = await page.request.get(`${BASE}${href}`);
	expect(res.headers()["content-type"]).toBe("application/manifest+json");
	const manifest = await res.json();
	expect(manifest).toMatchObject({
		id: "/",
		name: "Lemma",
		short_name: "Lemma",
		start_url: "/",
		scope: "/",
		display: "standalone",
		lang: "es",
	});
	// Installable: a 192 and a 512 icon, plus maskable ones, each a real PNG
	// of its stated size.
	const icons = manifest.icons as {
		src: string;
		sizes: string;
		purpose?: string;
	}[];
	for (const want of ["192x192", "512x512"]) {
		expect(icons.some((i) => i.sizes === want && !i.purpose)).toBe(true);
		expect(
			icons.some((i) => i.sizes === want && i.purpose === "maskable"),
		).toBe(true);
	}
	for (const icon of icons) {
		const size = await page.evaluate(async (src) => {
			const img = new Image();
			img.src = src;
			await img.decode();
			return `${img.naturalWidth}x${img.naturalHeight}`;
		}, icon.src);
		expect(size).toBe(icon.sizes);
	}

	const registration = await page.evaluate(async () => {
		const r = await navigator.serviceWorker.ready;
		return { script: r.active?.scriptURL, scope: r.scope };
	});
	expect(registration).toEqual({ script: `${BASE}/sw.js`, scope: `${BASE}/` });
	expect(problems).toEqual([]);
	await context.close();
});

test("the worker answers only the app shell: never /api, /files or /ws, and caches nothing else", async ({
	browser,
}) => {
	const context = await paired(browser);
	const responses: { url: string; fromSW: boolean }[] = [];
	context.on("response", (r) =>
		responses.push({ url: r.url(), fromSW: r.fromServiceWorker() }),
	);
	const sockets: string[] = [];
	context.on("page", (p) => p.on("websocket", (ws) => sockets.push(ws.url())));
	const { page, problems } = await openControlled(context);
	const file = await page.evaluate(async () => {
		const res = await fetch("/files/general/materials/nota.md");
		return { status: res.status, text: await res.text() };
	});
	expect(file).toEqual({ status: 200, text: "# Nota\n" });

	const path = (url: string) => new URL(url).pathname;
	// The shell came from the worker…
	const shell = responses.filter((r) => /^\/s\/[\w-]+$/.test(path(r.url)));
	expect(shell.some((r) => r.fromSW)).toBe(true);
	// …and the data never did.
	const data = responses.filter((r) => /^\/(api|files)\//.test(path(r.url)));
	expect(data.map((r) => path(r.url))).toEqual(
		expect.arrayContaining(["/api/state", "/files/general/materials/nota.md"]),
	);
	expect(data.filter((r) => r.fromSW)).toEqual([]);
	// A WebSocket never goes through a worker; it still connects.
	expect(sockets).toContain(`ws://127.0.0.1:${PORT}/ws`);

	// What the worker stored: the shell and its assets, nothing from the API.
	const cached = await page.evaluate(async () => {
		const urls: string[] = [];
		for (const key of await caches.keys()) {
			const cache = await caches.open(key);
			for (const req of await cache.keys())
				urls.push(new URL(req.url).pathname);
		}
		return urls;
	});
	expect(cached).toContain("/index.html");
	expect(
		cached.filter((u) => /^\/(api|files|pair|ws|fixtures)\b/.test(u)),
	).toEqual([]);
	expect(problems).toEqual([]);
	await context.close();
});

test("with the server stopped the shell still loads and says Lemma isn't running, then recovers by itself", async ({
	browser,
}) => {
	const context = await paired(browser);
	const { page, problems } = await openControlled(context);

	// The open window: the socket drops and the pill says so.
	await stop();
	await expect(page.getByRole("status")).toContainText(
		"Sin conexión con el servidor",
	);

	// A reload (or opening the app) while it's down: the shell from the cache.
	await page.reload();
	await expect(
		page.getByRole("heading", { name: "Lemma no está corriendo" }),
	).toBeVisible();

	// Back up: the screen goes on its own, no click.
	await start();
	await expect(composer(page)).toBeVisible({ timeout: 15_000 });
	await expect(
		page.getByRole("heading", { name: "Lemma no está corriendo" }),
	).toHaveCount(0);
	// Only the failed loads while the server was down.
	expect(
		problems.filter(
			(p) => !/ERR_CONNECTION_REFUSED|WebSocket connection/.test(p),
		),
	).toEqual([]);
	await context.close();
});

test("a rebuilt bundle reaches every open window: each offers the update and reloads into it", async ({
	browser,
}) => {
	const context = await paired(browser);
	const { page, problems } = await openControlled(context);
	// A second window of the app (say, a tab beside the app window).
	const other = await context.newPage();
	await other.goto(`${BASE}/`);
	await expect(composer(other)).toBeVisible();
	const build = (p: Page) => p.locator('meta[name="lemma-build"]');
	expect(await build(page).count()).toBe(0);

	// "Rebuild": a changed index.html, and the worker's precache list with its
	// new revision, as `bun run build` would make; then restart the server.
	await stop();
	const index = join(DIST, "index.html");
	writeFileSync(
		index,
		readFileSync(index, "utf8").replace(
			"<head>",
			'<head><meta name="lemma-build" content="2">',
		),
	);
	const sw = join(DIST, "sw.js");
	const before = readFileSync(sw, "utf8");
	const after = before.replace(
		/(url:"index\.html",revision:")[^"]+"/,
		`$1rebuilt-${Date.now()}"`,
	);
	expect(after).not.toBe(before);
	writeFileSync(sw, after);
	await start();

	// The page reconnects, checks for a new worker, and asks.
	const update = page.getByRole("button", { name: "Actualizar" });
	await expect(update).toBeVisible({ timeout: 15_000 });
	await expect(
		page.getByRole("status").filter({ hasText: "versión nueva" }),
	).toBeVisible();
	await update.click();
	await expect(build(page)).toHaveCount(1, { timeout: 15_000 });
	await expect(composer(page)).toBeVisible();

	// The other window now runs on the new worker; its pill still takes it to
	// the new build rather than leaving it on bundles no longer cached.
	await expect(build(other)).toHaveCount(0);
	await other.getByRole("button", { name: "Actualizar" }).click();
	await expect(build(other)).toHaveCount(1, { timeout: 15_000 });
	await expect(composer(other)).toBeVisible();
	expect(
		problems.filter(
			(p) => !/ERR_CONNECTION_REFUSED|WebSocket connection/.test(p),
		),
	).toEqual([]);
	await context.close();
});

test("an origin that isn't secure (a phone over LAN HTTP) gets no worker, and nothing errors", async ({
	browser,
}) => {
	// 192.0.2.10 (a documentation address) stands for the computer's LAN
	// address: plain HTTP on a non-loopback host, so not a secure context. The
	// route forwards it to the server with the Host and Origin it trusts.
	const lan = "http://192.0.2.10:4321";
	const context = await browser.newContext({ serviceWorkers: "allow" });
	await context.route(`${lan}/**`, async (route) => {
		const req = route.request();
		const headers = { ...req.headers() };
		if (headers.origin) headers.origin = BASE;
		const res = await route.fetch({
			url: req.url().replace(lan, BASE),
			headers,
		});
		await route.fulfill({ response: res });
	});
	const page = await context.newPage();
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	page.on("console", (m) => {
		// The unpaired screen's 403 is expected (no cookie on this origin).
		if (m.type() === "error" && !/status of 403/.test(m.text())) {
			errors.push(m.text());
		}
	});
	await page.goto(`${lan}/`);
	await expect(
		page.getByRole("heading", { name: "Vinculá este navegador" }),
	).toBeVisible();
	await page.waitForLoadState("load");
	const seen = await page.evaluate(() => ({
		secure: window.isSecureContext,
		sw: "serviceWorker" in navigator,
	}));
	expect(seen).toEqual({ secure: false, sw: false });
	// Nothing asked for the worker's chunk or script.
	expect(
		await page.evaluate(() =>
			performance
				.getEntriesByType("resource")
				.map((e) => new URL(e.name).pathname)
				.filter((p) => /register-|sw\.js|workbox/.test(p)),
		),
	).toEqual([]);
	expect(errors).toEqual([]);
	await context.close();
});
