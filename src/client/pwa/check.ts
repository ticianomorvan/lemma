/**
 * Asks the browser to look for a new build's service worker now, rather than
 * at the next navigation. A no-op without a worker (dev, the phone over LAN
 * HTTP); fails quietly while the server is down. The store calls it when its
 * socket comes back, since the server restarts after a build; register.ts when
 * the window comes back into view.
 */
export function checkForUpdate() {
	navigator.serviceWorker
		?.getRegistration()
		.then((registration) => registration?.update())
		.catch(() => {});
}
