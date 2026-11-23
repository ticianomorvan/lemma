import { useSyncExternalStore } from "react";

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

/** The colour scheme in effect, for renderers that bake colours into their output. */
export const useScheme = () =>
	useSyncExternalStore(subscribe, scheme, () => "light" as Scheme);

/** The current value of a theme token, such as `--primary`, as a CSS colour. */
export const token = (name: string) =>
	getComputedStyle(document.documentElement).getPropertyValue(name).trim();
