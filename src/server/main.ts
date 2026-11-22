import { fileURLToPath } from "node:url";
import { APP_NAME } from "../shared/app.ts";
import { SdkDriver } from "./agent/sdk.ts";
import { startServer } from "./http.ts";

const production = process.env.NODE_ENV === "production";
const port = parsePort(process.env.PORT ?? "4317");

const server = await startServer({
	port,
	distDir: production
		? fileURLToPath(new URL("../../dist", import.meta.url))
		: null,
	// The study folder arrives in step 3; until then the agent's read-only
	// tools see this directory.
	driver: new SdkDriver(process.env.LEMMA_STUDY_DIR ?? process.cwd()),
});
console.log(
	production
		? `${APP_NAME} on ${server.url}`
		: `${APP_NAME} API on ${server.url}; open the Vite dev server instead`,
);

function parsePort(value: string) {
	const port = Number(value);
	if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
		throw new Error(
			`PORT must be a whole number from 1 to 65535, got "${value}"`,
		);
	}
	return port;
}
