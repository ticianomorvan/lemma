/**
 * The three layouts the views are built for, from one pair of media queries:
 * a phone below 640 px, a tablet to 1023 px, a desktop from 1024 px. Views
 * branch on this instead of each keeping their own queries or `sm:`/`lg:`
 * classes, so every part of a view agrees on which layout it is in.
 */
import { useSyncExternalStore } from "react";

export type Layout = "phone" | "tablet" | "desktop";

const TABLET = "(min-width: 640px)";
const DESKTOP = "(min-width: 1024px)";

function subscribe(onChange: () => void) {
	const queries = [matchMedia(TABLET), matchMedia(DESKTOP)];
	for (const q of queries) q.addEventListener("change", onChange);
	return () => {
		for (const q of queries) q.removeEventListener("change", onChange);
	};
}

function current(): Layout {
	if (matchMedia(DESKTOP).matches) return "desktop";
	return matchMedia(TABLET).matches ? "tablet" : "phone";
}

export function useLayout(): Layout {
	return useSyncExternalStore(subscribe, current);
}
