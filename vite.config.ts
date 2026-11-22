import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Port of the Bun server (`src/server/main.ts`) that the dev server forwards `/api` and `/ws` to. */
const apiPort = Number(process.env.PORT ?? 4317);
const api = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
	root: "src/client",
	plugins: [react(), tailwindcss()],
	build: { outDir: "../../dist", emptyOutDir: true },
	server: {
		host: "127.0.0.1",
		port: 5173,
		strictPort: true,
		// The Bun server checks Origin itself, so the proxy must not rewrite it.
		proxy: {
			"/api": api,
			"/ws": { target: api, ws: true },
		},
	},
});
