import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Port of the Bun server (`src/server/main.ts`) that the dev server forwards `/api` and `/ws` to. */
const apiPort = Number(process.env.PORT ?? 4317);
const api = `http://127.0.0.1:${apiPort}`;

/**
 * `--mode prototype` builds the design prototypes into their own folder for
 * `vite preview`; the app's build (`bun run build`) never includes them, and
 * e2e/app.pw.ts checks that the server doesn't serve them.
 */
export default defineConfig(({ mode }) => ({
	root: "src/client",
	plugins: [react(), tailwindcss()],
	build: {
		outDir: mode === "prototype" ? "../../dist-prototype" : "../../dist",
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
				...(mode === "prototype"
					? { read: "src/client/prototypes/read.html" }
					: {}),
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
			"/pair": api,
			"/ws": { target: api, ws: true },
		},
	},
	preview: { host: "127.0.0.1", port: 4173, strictPort: true },
}));
