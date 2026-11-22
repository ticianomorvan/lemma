import { fileURLToPath } from "node:url";
import { APP_NAME } from "../shared/app.ts";
import type { AgentDriver } from "./agent/driver.ts";
import { FakeDriver } from "./agent/fake.ts";
import { SdkDriver } from "./agent/sdk.ts";
import { startServer } from "./http.ts";

const production = process.env.NODE_ENV === "production";
const port = parsePort(process.env.PORT ?? "4317");

const server = await startServer({
	port,
	distDir: production
		? fileURLToPath(new URL("../../dist", import.meta.url))
		: null,
	driver: driver(),
});
console.log(
	production
		? `${APP_NAME} on ${server.url}`
		: `${APP_NAME} API on ${server.url}; open the Vite dev server instead`,
);

/**
 * `LEMMA_FAKE=1` replays recorded streams instead of calling Claude, for
 * Playwright and for trying the UI offline. A message containing
 * `<!--fixture:<name>-->` (best as its own last paragraph) replays `test/fixtures/streams/<name>.jsonl` (an
 * HTML comment, which the thread hides); others replay
 * `math-rich`. `LEMMA_FAKE_DELAY_MS` paces each SDK message (25 ms).
 */
function driver(): AgentDriver {
	if (process.env.LEMMA_FAKE !== "1") {
		// The study folder arrives in step 3; until then the agent's read-only
		// tools see this directory.
		return new SdkDriver(process.env.LEMMA_STUDY_DIR ?? process.cwd());
	}
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
