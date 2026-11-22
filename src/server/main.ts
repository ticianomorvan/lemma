import { startServer } from "./http.ts";

const production = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 4317);

const server = await startServer({
	port,
	distDir: production ? "dist" : undefined,
});
console.log(`Lemma on ${server.url} (${production ? "production" : "dev"})`);
