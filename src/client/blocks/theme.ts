import { createContext, use, useSyncExternalStore } from "react";

export type Scheme = "light" | "dark";

/** Dark mode follows the system unless `<html data-theme>` overrides it (globals.css). */
function scheme(): Scheme {
	const set = document.documentElement.dataset.theme;
	if (set === "light" || set === "dark") return set;
	return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function subscribe(onChange: () => void) {
	const mq = matchMedia("(prefers-color-scheme: dark)");
	mq.addEventListener("change", onChange);
	const mo = new MutationObserver(onChange);
	mo.observe(document.documentElement, { attributeFilter: ["data-theme"] });
	return () => {
		mq.removeEventListener("change", onChange);
		mo.disconnect();
	};
}

/**
 * A scheme a subtree draws in whatever the page's is: the print copy of a
 * session is light (it sits in a `.theme-light` box).
 */
export const SchemeOverride = createContext<Scheme | null>(null);

/** The colour scheme in effect, for renderers that bake colours into their output. */
export function useScheme(): Scheme {
	const forced = use(SchemeOverride);
	const page = useSyncExternalStore(subscribe, scheme, () => "light" as Scheme);
	return forced ?? page;
}

let lightProbe: HTMLElement | undefined;

/**
 * The value of a theme token, such as `--primary`, as a CSS colour, in
 * `inScheme` (the page's own by default). Light tokens on a dark page come
 * from a hidden `.theme-light` element.
 */
export function token(name: string, inScheme?: Scheme) {
	let from = document.documentElement;
	if (inScheme === "light" && scheme() === "dark") {
		if (!lightProbe?.isConnected) {
			lightProbe = document.createElement("div");
			lightProbe.className = "theme-light";
			lightProbe.hidden = true;
			document.body.append(lightProbe);
		}
		from = lightProbe;
	}
	return getComputedStyle(from).getPropertyValue(name).trim();
}
