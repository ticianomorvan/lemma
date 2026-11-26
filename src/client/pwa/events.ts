/**
 * How the app tells the service worker's lazy chunk (register.ts) something
 * without importing it, so the first load carries neither Workbox nor the chunk.
 */

/** The server answered again after being unreachable: worth checking for a new build. */
export const RECONNECTED = "lemma:reconnected";

export const reconnected = () =>
	globalThis.dispatchEvent?.(new Event(RECONNECTED));
