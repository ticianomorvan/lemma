import { fileURLToPath } from "node:url";
import { APP_NAME } from "../shared/app.ts";
import { startServer } from "./http.ts";

const production = process.env.NODE_ENV === "production";
const port = parsePort(process.env.PORT ?? "4317");

const server = await startServer({
	port,
	client: production
		? {
				mode: "prod",
				distDir: fileURLToPath(new URL("../../dist", import.meta.url)),
			}
		: { mode: "dev" },
});
console.log(
	`${APP_NAME} on ${server.url} (${production ? "production" : "dev"})`,
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
