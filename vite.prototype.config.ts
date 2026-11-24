import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * The step 7 design prototype on its own: `bun run preview:prototype` builds
 * only `prototypes/read.html` into `dist-prototype/` and serves it, with `/`
 * sent there. The app's build (vite.config.ts) never includes it, and
 * e2e/app.pw.ts checks that the server doesn't serve it. Step 8 deletes this
 * file with the route.
 */
const PROTOTYPE = "/prototypes/read.html";

const home: Plugin = {
	name: "prototype-home",
	configurePreviewServer(server) {
		server.middlewares.use((req, res, next) => {
			if (req.url !== "/" && req.url !== "/index.html") return next();
			res.statusCode = 302;
			res.setHeader("location", PROTOTYPE);
			res.end();
		});
	},
};

export default defineConfig({
	root: "src/client",
	plugins: [react(), tailwindcss(), home],
	build: {
		outDir: "../../dist-prototype",
		emptyOutDir: true,
		chunkSizeWarningLimit: 1600,
		rolldownOptions: { input: { read: "src/client/prototypes/read.html" } },
	},
	preview: { host: "127.0.0.1", port: 4173, strictPort: true, open: PROTOTYPE },
});
