/**
 * Registers the service worker (vite.config.ts → VitePWA), in its own chunk
 * that main.tsx loads after the page has loaded, and only in a secure context.
 *
 * Updates: a new build's worker installs beside the running one and waits.
 * Every open window then shows "Actualizar" (update-pill.tsx). Pressing it in
 * one window activates the new worker and reloads that window. The others now
 * run on the new worker, whose cache no longer holds their old bundles, so
 * their pill just reloads. If nobody presses it, the old build keeps working
 * from its precache until every window of the app closes, and the next open
 * gets the new one.
 */
import { registerSW } from "virtual:pwa-register";
import { checkForUpdate } from "./check.ts";

const show = (apply: () => void) =>
	void import("./update-pill.tsx").then(({ showUpdate }) => showUpdate(apply));

let pressed = false;
const update = registerSW({
	onNeedRefresh() {
		show(() => {
			pressed = true;
			void update(true);
		});
	},
	// The new worker took over, from this window or another. The plugin would
	// reload every window here; only the one that pressed does, and the others
	// ask, so no draft is lost.
	onNeedReload() {
		if (pressed) location.reload();
		else show(() => location.reload());
	},
});

document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible") checkForUpdate();
});
