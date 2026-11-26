import { fileURLToPath } from "node:url";
import { APP_NAME } from "../shared/app.ts";
import type { AgentDriver } from "./agent/driver.ts";
import { FakeDriver } from "./agent/fake.ts";
import { SdkDriver } from "./agent/sdk.ts";
import { Auth } from "./auth/auth.ts";
import { configDir, readConfig, saveConfig } from "./config.ts";
import { startServer } from "./http.ts";
import { lanAddress } from "./lan.ts";

const production = process.env.NODE_ENV === "production";
/**
 * The Vite dev server (vite.config.ts). Trusted only when `bun run dev` says
 * so with `LEMMA_DEV=1`, never in production, so a server started some other
 * way doesn't trust whatever else holds port 5173.
 */
const DEV_ORIGIN = "http://127.0.0.1:5173";
const dev = !production && process.env.LEMMA_DEV === "1";
const config = readConfig();
const port = parsePort(process.env.PORT ?? String(config.port ?? 4317));
const override = process.env.LEMMA_STUDY_DIR;
// Before binding: a broken devices.json stops startup here.
const auth = new Auth({
	dir: configDir(),
	...(dev ? { devOrigin: DEV_ORIGIN } : {}),
});

const server = await startServer({
	port,
	distDir: production
		? fileURLToPath(new URL("../../dist", import.meta.url))
		: null,
	driver: driver(),
	studyDir: override ?? config.folder ?? null,
	// With the override set, the screen never shows, so nothing is saved.
	saveStudyDir: (folder) => saveConfig({ folder }),
	auth,
	// Nobody is left to ask for a link: print one (without opening a browser).
	onNoDevices: () => pairDesktop({ open: false }),
	// `LEMMA_LAN_ADDRESS` picks the address (tests use `::1`).
	lanAddress: () => process.env.LEMMA_LAN_ADDRESS || lanAddress(),
});
console.log(
	production
		? `${APP_NAME} on ${server.url}`
		: `${APP_NAME} API on ${server.url}; open the Vite dev server instead`,
);
pairDesktop();

/**
 * Prints a one-time pairing link and opens it in the default browser. A
 * browser that is already paired just lands in the app, so opening it on every
 * start adds no device. In dev (`bun --watch` restarts on every save) it opens
 * only while nothing is paired. `LEMMA_OPEN=0` never opens it (tests, CI).
 */
function pairDesktop({ open = true } = {}) {
	const { url, expiresAt } = auth.startPairing();
	const minutes = Math.round((Date.parse(expiresAt) - Date.now()) / 60_000);
	console.log(`Pair this browser: ${url} (one use, valid ${minutes} min)`);
	const opening =
		open &&
		process.env.LEMMA_OPEN !== "0" &&
		(production || auth.list().length === 0);
	if (!opening) return;
	try {
		Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", url], {
			stdio: ["ignore", "ignore", "ignore"],
		});
	} catch {
		// No opener (a headless box): the printed link is enough.
	}
}

/**
 * `LEMMA_FAKE=1` replays recorded streams instead of calling Claude, for
 * Playwright and for trying the UI offline. A message containing
 * `<!--fixture:<name>-->` (best as its own last paragraph) replays `test/fixtures/streams/<name>.jsonl` (an
 * HTML comment, which the thread hides); others replay
 * `math-rich`. `LEMMA_FAKE_DELAY_MS` paces each SDK message (25 ms).
 */
function driver(): AgentDriver {
	if (process.env.LEMMA_FAKE !== "1") return new SdkDriver();
	const delay = Number(process.env.LEMMA_FAKE_DELAY_MS ?? 25);
	return new FakeDriver({
		streams: ["math-rich"],
		pick: (text) => /<!--fixture:([\w-]+)-->/.exec(text)?.[1],
		pace: () => Bun.sleep(delay),
	});
}

function parsePort(value: string) {
	const port = Number(value);
	if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
		throw new Error(
			`PORT must be a whole number from 1 to 65535, got "${value}"`,
		);
	}
	return port;
}
