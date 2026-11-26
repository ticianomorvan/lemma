import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/** Port of the Bun server (`src/server/main.ts`) that the dev server forwards `/api`, `/pair`, `/files` and `/ws` to. */
const apiPort = Number(process.env.PORT ?? 4317);
const api = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
	root: "src/client",
	plugins: [
		react(),
		tailwindcss(),
		// The installable app (docs/architecture.md → Installable app): a
		// manifest and a Workbox service worker that precaches the app shell
		// only. The page registers it itself, after load, in its own chunk
		// (client/pwa/), and asks before switching to a new build.
		VitePWA({
			registerType: "prompt",
			injectRegister: false,
			manifest: {
				id: "/",
				name: "Lemma",
				short_name: "Lemma",
				description:
					"Estudiá matemática con Claude, sobre tu carpeta de estudio.",
				lang: "es",
				start_url: "/",
				scope: "/",
				display: "standalone",
				// globals.css: --background (the tile and the splash) and --card (the
				// header, which the title bar continues). index.html sets the dark
				// theme color.
				background_color: "#f6f5f1",
				theme_color: "#ffffff",
				icons: [
					{ src: "/icon-192.png", sizes: "192x192", type: "image/png" },
					{ src: "/icon-512.png", sizes: "512x512", type: "image/png" },
					{
						src: "/icon-maskable-192.png",
						sizes: "192x192",
						type: "image/png",
						purpose: "maskable",
					},
					{
						src: "/icon-maskable-512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
				],
			},
			workbox: {
				// The shell: the page, its hashed bundles (the lazy renderers too, so
				// a page on an old build keeps working until it reloads), styles,
				// fonts and icons. Never the diagram fixture page.
				globPatterns: ["**/*.{html,js,mjs,css,woff2,png,svg,webmanifest}"],
				globIgnores: ["fixtures/**"],
				// Graphviz (WASM inlined) is the largest chunk, about 1.5 MB.
				maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
				// Only the app's own pages get the cached shell. Everything else
				// (/api, /files, /ws, /pair links, the fixture page) has no route in
				// the worker and goes to the network untouched; with no runtime
				// caching, nothing but the shell is ever stored.
				navigateFallback: "/index.html",
				navigateFallbackAllowlist: [/^\/$/, /^\/s\/[\w-]+$/],
				cleanupOutdatedCaches: true,
			},
		}),
	],
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
