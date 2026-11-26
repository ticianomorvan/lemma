import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Port of the Bun server (`src/server/main.ts`) that the dev server forwards `/api`, `/pair`, `/files` and `/ws` to. */
const apiPort = Number(process.env.PORT ?? 4317);
const api = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
	root: "src/client",
	plugins: [react(), tailwindcss()],
	build: {
		outDir: "../../dist",
		emptyOutDir: true,
		// Graphviz (WASM inlined), Vega and Mermaid's layout engines are lazy
		// chunks of 0.6–1.5 MB that load only for a block of their kind. The
		// first load has its own budget, checked in e2e/blocks.pw.ts.
		chunkSizeWarningLimit: 1600,
		rolldownOptions: {
			input: {
				main: "src/client/index.html",
				// The diagram fixture page Playwright checks (no data, no API).
				blocks: "src/client/fixtures/blocks.html",
			},
		},
	},
	server: {
		host: "127.0.0.1",
		port: 5173,
		strictPort: true,
		// The Bun server checks Host and Origin itself, so the proxy must not
		// rewrite them; it trusts this origin in dev only.
		proxy: {
			"/api": api,
			// Opening a pairing link loads the app (Vite serves it); the app
			// redeems the code with a POST, which goes to Bun.
			"/pair": {
				target: api,
				bypass: (req) => (req.method === "GET" ? "/index.html" : undefined),
			},
			"/files": api,
			"/ws": { target: api, ws: true },
		},
	},
});
