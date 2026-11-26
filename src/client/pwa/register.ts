/**
 * Registers the service worker (vite.config.ts → VitePWA), in its own chunk
 * that main.tsx loads after the page has loaded, and only in a secure context.
 *
 * Updates: a new build's worker installs beside the running one and waits.
 * The page then shows "Actualizar" (update-pill.tsx); pressing it activates the
 * new worker and reloads. A page that never presses it keeps the old build,
 * whose bundles stay precached, until every window of the app closes: the next
 * open gets the new one. The browser looks for a new worker on every
 * navigation; this also looks when the server answers again after being down
 * (it restarts after a build) and when the window comes back into view.
 */
import { registerSW } from "virtual:pwa-register";
import { RECONNECTED } from "./events.ts";

const update = registerSW({
	onNeedRefresh() {
		void import("./update-pill.tsx").then(({ showUpdate }) =>
			showUpdate(() => update(true)),
		);
	},
	onRegisteredSW(_url, registration) {
		if (!registration) return;
		const check = () => {
			// Rejects while the server is down; the next check tries again.
			registration.update().catch(() => {});
		};
		window.addEventListener(RECONNECTED, check);
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") check();
		});
	},
});
