/**
 * Auth: pairing codes, device cookies, and the Host/Origin screen, against the
 * real server (FakeDriver behind it). See docs/architecture.md → Security.
 */
import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { FakeDriver } from "../agent/fake.ts";
import {
	authOf,
	Client,
	cleanUp,
	pair,
	type Server,
	serve,
	start,
	studyDir,
} from "../testing.ts";
import { Auth, CODE_TTL_MS, deviceName } from "./auth.ts";

afterEach(cleanUp);

const DEV_ORIGIN = "http://127.0.0.1:5173";

/** Every route that needs a paired device, with a body it would accept. */
const GATED: [method: string, path: string, body?: unknown][] = [
	["GET", "/api/state"],
	["POST", "/api/folder", { path: "/tmp/lemma-never" }],
	["POST", "/api/sessions", { course: "general" }],
	["GET", "/api/sessions/x"],
	["PATCH", "/api/sessions/x", { title: "t" }],
	["POST", "/api/sessions/x/messages", { clientMsgId: "m", text: "hola" }],
	["POST", "/api/sessions/x/interrupt", {}],
	["POST", "/api/pair", {}],
	["GET", "/api/devices"],
	["DELETE", "/api/devices/x"],
	["GET", "/api/anything-else"],
];

/**
 * The status line a raw WebSocket handshake gets. Bun's WebSocket client
 * hides it (a refused upgrade is just an error event), so this speaks HTTP.
 */
function upgradeStatus(server: Server, headers: Record<string, string>) {
	const lines = Object.entries({
		host: server.url.host,
		upgrade: "websocket",
		connection: "Upgrade",
		// Any 16 random bytes, base64.
		"sec-websocket-key": randomBytes(16).toString("base64"),
		"sec-websocket-version": "13",
		...headers,
	}).map(([k, v]) => `${k}: ${v}`);
	return new Promise<number>((resolve, reject) => {
		const socket = connect(server.port as number, "127.0.0.1", () =>
			socket.write(`GET /ws HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`),
		);
		socket.once("data", (data) => {
			socket.destroy();
			resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(String(data))?.[1]));
		});
		socket.once("error", reject);
	});
}

async function errorCode(res: Response) {
	return ((await res.json()) as { error: { code: string } }).error.code;
}

test("a request with no token gets a 403 on every API route", async () => {
	const { api } = await serve({ streams: ["math"] });
	for (const [method, path, body] of GATED) {
		const res = await api(path, body, method, { cookie: "" });
		expect([method, path, res.status]).toEqual([method, path, 403]);
		expect(await errorCode(res)).toBe("unpaired");
	}
});

test("a WebSocket upgrade needs a device cookie", async () => {
	const { server, cookie } = await serve({ streams: ["math"] });
	const origin = server.url.origin;
	expect(await upgradeStatus(server, { origin })).toBe(403);
	expect(
		await upgradeStatus(server, { origin, cookie: "lemma-1=forged" }),
	).toBe(403);
	expect(await upgradeStatus(server, { origin, cookie })).toBe(101);
});

test("a WebSocket upgrade from a foreign origin gets a 403, even with the cookie", async () => {
	const { server, cookie } = await serve({ streams: ["math"] });
	for (const origin of ["http://evil.example", "null", DEV_ORIGIN]) {
		expect(await upgradeStatus(server, { origin, cookie })).toBe(403);
	}
	// A non-browser client sends no Origin; the cookie still has to be right.
	expect(await upgradeStatus(server, { cookie })).toBe(101);
});

test("a POST from a foreign origin gets a 403, even with the cookie", async () => {
	const { api } = await serve({ streams: ["math"] });
	for (const origin of ["http://evil.example", "http://127.0.0.1:1", "null"]) {
		const res = await api("/api/sessions", { course: "x" }, "POST", { origin });
		expect(res.status).toBe(403);
		expect(await errorCode(res)).toBe("bad_origin");
	}
	const del = await api("/api/devices/x", undefined, "DELETE", {
		origin: "http://evil.example",
	});
	expect(del.status).toBe(403);
	const ok = await api("/api/sessions", { course: "x" });
	expect(ok.status).toBe(201);
});

test("a foreign Host header gets a 403 everywhere, pairing and static files included", async () => {
	const { server, api } = await serve({ streams: ["math"] });
	const { url } = authOf(server).startPairing();
	for (const host of ["evil.example", "evil.example:4317", "127.0.0.1:1"]) {
		const res = await api("/api/state", undefined, "GET", { host });
		expect(res.status).toBe(403);
		expect(await errorCode(res)).toBe("bad_host");
		const pairing = await fetch(url, { headers: { host }, redirect: "manual" });
		expect(pairing.status).toBe(403);
		expect(await upgradeStatus(server, { host })).toBe(403);
	}
	// The code survived: a refused request never reached it.
	expect((await fetch(url, { redirect: "manual" })).status).toBe(303);
	// localhost is ours too.
	const local = await api("/api/state", undefined, "GET", {
		host: `localhost:${server.port}`,
	});
	expect(local.status).toBe(200);
});

test("POST /api/folder, the first-run choice, is gated", async () => {
	const saved: string[] = [];
	const { api } = await start({
		port: 0,
		distDir: null,
		driver: new FakeDriver({ streams: [] }),
		studyDir: null,
		saveStudyDir: (path) => saved.push(path),
	});
	const path = join(await studyDir(), "Estudio");
	const anonymous = await api("/api/folder", { path }, "POST", { cookie: "" });
	expect(anonymous.status).toBe(403);
	const foreign = await api("/api/folder", { path }, "POST", {
		origin: "http://evil.example",
	});
	expect(foreign.status).toBe(403);
	expect(saved).toEqual([]);
	expect((await api("/api/folder", { path })).status).toBe(201);
	expect(saved).toEqual([path]);
});

test("a pairing code works once, then gets a 403", async () => {
	const { server } = await serve({ streams: ["math"] });
	const { url, expiresAt } = authOf(server).startPairing();
	expect(url).toMatch(
		new RegExp(`^http://127\\.0\\.0\\.1:${server.port}/pair/[\\w-]{22}$`),
	);
	expect(Date.parse(expiresAt) - Date.now()).toBeCloseTo(CODE_TTL_MS, -4);

	const first = await fetch(url, { redirect: "manual" });
	expect(first.status).toBe(303);
	expect(first.headers.get("location")).toBe("/");
	const cookie = first.headers.get("set-cookie") ?? "";
	expect(cookie).toMatch(
		new RegExp(`^lemma-${server.port}=[\\w-]{43}; .*HttpOnly`, "i"),
	);
	expect(cookie).toMatch(/SameSite=Strict/i);
	expect(cookie).toMatch(/Path=\//);

	const again = await fetch(url, { redirect: "manual" });
	expect(again.status).toBe(403);
	expect(again.headers.get("set-cookie")).toBeNull();
	const made = await fetch(new URL("/pair/not-a-code", server.url), {
		redirect: "manual",
	});
	expect(made.status).toBe(403);
});

test("a pairing code expires after 5 minutes", async () => {
	let now = Date.parse("2026-11-22T10:00:00Z");
	const auth = new Auth({ dir: await studyDir(), now: () => now }).listen(4317);
	const browser = new Request("http://127.0.0.1:4317/");
	const code = (url: string) => url.split("/pair/")[1] as string;
	const late = code(auth.startPairing().url);
	const onTime = code(auth.startPairing().url);
	now += CODE_TTL_MS - 1;
	expect(auth.redeem(onTime, browser)).not.toBeNull();
	now += 1;
	expect(auth.redeem(late, browser)).toBeNull();
});

test("a revoked token gets a 403, and its open sockets close", async () => {
	const { server, api, cookie } = await serve({ streams: ["math"] });
	const other = await pair(server, {
		"user-agent":
			"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1",
	});
	const asOther = { cookie: other };
	const listed = await (
		await api("/api/devices", undefined, "GET", asOther)
	).json();
	expect(listed.devices).toHaveLength(2);
	const phone = listed.devices.find(
		(d: { id: string }) => d.id === listed.current,
	);
	expect(phone.name).toBe("Safari en iPhone");

	const { id } = await (await api("/api/sessions", { course: "x" })).json();
	const watching = await Client.subscribe(server, id);
	const closed = new Promise((resolve) => (watching.ws.onclose = resolve));

	// Revoked from the first device; the phone loses access at once.
	const revoke = await api(`/api/devices/${phone.id}`, undefined, "DELETE");
	expect(revoke.status).toBe(204);
	const after = await api("/api/state", undefined, "GET", asOther);
	expect(after.status).toBe(403);
	expect(await errorCode(after)).toBe("unpaired");
	expect(
		await upgradeStatus(server, { origin: server.url.origin, ...asOther }),
	).toBe(403);
	// The first device's own socket is untouched.
	expect(watching.ws.readyState).toBe(WebSocket.OPEN);
	expect((await api("/api/state")).status).toBe(200);
	expect(
		(await api(`/api/devices/${phone.id}`, undefined, "DELETE")).status,
	).toBe(404);

	// Revoking yourself closes your sockets too.
	const me = (await (await api("/api/devices")).json()).current;
	expect((await api(`/api/devices/${me}`, undefined, "DELETE")).status).toBe(
		204,
	);
	await closed;
	expect((await api("/api/state")).status).toBe(403);
	expect(cookie).not.toBe(other);
});

test("POST /api/pair hands a paired device a link for another browser", async () => {
	const { server, api } = await serve({ streams: ["math"] });
	const res = await api("/api/pair", {});
	expect(res.status).toBe(201);
	const { url } = (await res.json()) as { url: string };
	const second = await fetch(url, { redirect: "manual" });
	expect(second.status).toBe(303);
	expect(authOf(server).list()).toHaveLength(2);
});

test("opening a link in a browser that is already paired adds no device", async () => {
	const { server, cookie } = await serve({ streams: ["math"] });
	const { url } = authOf(server).startPairing();
	const res = await fetch(url, { redirect: "manual", headers: { cookie } });
	expect(res.status).toBe(303);
	expect(res.headers.get("set-cookie")).toBeNull();
	expect(authOf(server).list()).toHaveLength(1);
	// The code is spent all the same.
	expect((await fetch(url, { redirect: "manual" })).status).toBe(403);
});

test("devices.json keeps only token hashes, private to the user, across restarts", async () => {
	const dir = await studyDir();
	const auth = new Auth({ dir }).listen(4317);
	const code = auth.startPairing().url.split("/pair/")[1] as string;
	const redeemed = auth.redeem(code, new Request("http://127.0.0.1:4317/"));
	const cookie = (redeemed?.cookie ?? "").split(";")[0] as string;
	const token = cookie.split("=")[1] as string;
	expect(token).toHaveLength(43); // 32 bytes, base64url

	const file = join(dir, "devices.json");
	const text = await readFile(file, "utf8");
	expect(text).not.toContain(token);
	expect(JSON.parse(text).devices[0].tokenHash).toBe(
		new Bun.CryptoHasher("sha256").update(token).digest("hex"),
	);
	expect((await stat(file)).mode & 0o777).toBe(0o600);

	const restarted = new Auth({ dir }).listen(4317);
	const req = new Request("http://127.0.0.1:4317/", { headers: { cookie } });
	expect(restarted.check(req)?.id).toBe(redeemed?.device.id as string);
	// A restart forgets pairing codes.
	expect(
		restarted.redeem(code, new Request("http://127.0.0.1:4317/")),
	).toBeNull();
});

test("a broken devices.json stops the server instead of pairing nobody", async () => {
	const dir = await studyDir();
	await Bun.write(join(dir, "devices.json"), "{ not json");
	expect(() => new Auth({ dir })).toThrow("devices.json");
});

test("the dev server's origin is trusted only when the server is told so", async () => {
	const devHeaders = { origin: DEV_ORIGIN, host: "127.0.0.1:5173" };
	// What `bun run start` builds: no dev origin.
	const production = await serve({ streams: ["math"] });
	const refused = await production.api(
		"/api/sessions",
		{ course: "x" },
		"POST",
		devHeaders,
	);
	expect(refused.status).toBe(403);
	// The dev origin alone, sent straight to this server, is refused too.
	const direct = await production.api(
		"/api/sessions",
		{ course: "x" },
		"POST",
		{
			origin: DEV_ORIGIN,
		},
	);
	expect(direct.status).toBe(403);
	expect(await errorCode(direct)).toBe("bad_origin");
	expect(
		await upgradeStatus(production.server, {
			...devHeaders,
			cookie: production.cookie,
		}),
	).toBe(403);

	const dev = await start({
		port: 0,
		distDir: null,
		driver: new FakeDriver({ streams: [] }),
		studyDir: await studyDir(),
		devOrigin: DEV_ORIGIN,
	});
	const allowed = await dev.api("/api/sessions", { course: "x" }, "POST", {
		...devHeaders,
	});
	expect(allowed.status).toBe(201);
	// Pairing links point at the dev server, which forwards /pair here.
	expect(authOf(dev.server).startPairing().url).toStartWith(
		`${DEV_ORIGIN}/pair/`,
	);
});

test("revoking the last device asks for a new startup link", async () => {
	let called = 0;
	const { api } = await start({
		port: 0,
		distDir: null,
		driver: new FakeDriver({ streams: [] }),
		studyDir: null,
		onNoDevices: () => called++,
	});
	const { current } = await (await api("/api/devices")).json();
	expect(
		(await api(`/api/devices/${current}`, undefined, "DELETE")).status,
	).toBe(204);
	expect(called).toBe(1);
});

test("a pairing code survives a failed write of devices.json", async () => {
	const dir = await studyDir();
	const auth = new Auth({ dir: join(dir, "config") }).listen(4317);
	const code = auth.startPairing().url.split("/pair/")[1] as string;
	// A file where the folder should be: saving fails.
	await Bun.write(join(dir, "config"), "");
	const req = new Request("http://127.0.0.1:4317/");
	expect(() => auth.redeem(code, req)).toThrow();
	await rm(join(dir, "config"));
	expect(auth.redeem(code, req)?.cookie).toBeString();
	expect(auth.redeem(code, req)).toBeNull();
});

test("device names come from the User-Agent", () => {
	expect(
		deviceName(
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
		),
	).toBe("Chrome en macOS");
	expect(
		deviceName(
			"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
		),
	).toBe("Chrome en iPhone");
	expect(deviceName("curl/8.7.1")).toBe("Navegador");
});
