/**
 * Printing a session (docs/architecture.md → Printing). `print()` mounts the
 * print copy, waits until everything in it has drawn (Markdown, every
 * diagram, photos, fonts), shrinks what is wider than the page, then opens
 * the browser's print dialog; the copy unmounts when the dialog closes.
 * ⌘P / Ctrl+P go through it too. A print the page can't intercept (the
 * browser's menu) mounts the copy on `beforeprint` and prints what has drawn
 * by then; a block still drawing prints its source.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { SessionView } from "../../shared/protocol.ts";
import { PrintSession } from "./print-session.tsx";

/** Longest wait for the copy to draw before printing it anyway. */
const READY_TIMEOUT_MS = 20_000;

/** What isn't drawn yet: the Markdown chunk, a diagram, a Vega chart inside one. */
const PENDING =
	"[data-md-loading], .diagram[data-state='loading'], .diagram-loading";

export function usePrint(view: SessionView | undefined) {
	const title =
		view && `${view.meta.title || "Sin título"} · ${view.meta.course}`;
	const [printing, setPrinting] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	/** The copy is drawn and fitted: `beforeprint` has nothing to do. */
	const prepared = useRef(false);
	const busy = useRef<Promise<void>>(undefined);
	const titleRef = useRef(title);
	titleRef.current = title;

	const mount = useCallback(() => {
		const before = document.title;
		flushSync(() => setPrinting(true));
		if (titleRef.current) document.title = titleRef.current;
		return before;
	}, []);

	const print = useCallback(() => {
		busy.current ??= (async () => {
			const before = mount();
			const el = root.current;
			if (el) {
				await drawn(el);
				fit(el);
			}
			prepared.current = true;
			// The dialog's default file name is the page's title.
			window.print();
			// Most browsers block in print() and fire `afterprint` before it
			// returns; restoring here too covers those that don't.
			document.title = before;
		})().finally(() => {
			busy.current = undefined;
		});
		return busy.current;
	}, [mount]);

	useEffect(() => {
		let before: string | undefined;
		const onBefore = () => {
			if (prepared.current) return;
			before = mount();
			if (root.current) fit(root.current);
		};
		const onAfter = () => {
			prepared.current = false;
			if (before !== undefined) document.title = before;
			before = undefined;
			setPrinting(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && !e.altKey && e.code === "KeyP") {
				e.preventDefault();
				void print();
			}
		};
		window.addEventListener("beforeprint", onBefore);
		window.addEventListener("afterprint", onAfter);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("beforeprint", onBefore);
			window.removeEventListener("afterprint", onAfter);
			window.removeEventListener("keydown", onKey);
		};
	}, [mount, print]);

	/** The copy, in a portal on `<body>`, while printing. */
	const node =
		printing && view
			? createPortal(<PrintSession view={view} ref={root} />, document.body)
			: null;
	return { node, print };
}

/** Resolves once nothing in `el` is still loading, or after the timeout. */
async function drawn(el: HTMLElement) {
	const end = performance.now() + READY_TIMEOUT_MS;
	const frame = () => new Promise((r) => setTimeout(r, 50));
	while (el.querySelector(PENDING) && performance.now() < end) await frame();
	await Promise.all(
		[...el.querySelectorAll("img")].map((img) => img.decode().catch(() => {})),
	);
	await document.fonts.ready;
}

/**
 * What can't wrap (a proof tree, a wide formula or table, a diagram at its
 * natural size) is zoomed down to the column, instead of being cut off at
 * the page edge. The copy is laid out at the page's width (print.css), so
 * this measures what the page will show.
 */
function fit(el: HTMLElement) {
	const wide = el.querySelectorAll<HTMLElement>(
		".diagram-scroll > *, .katex-display > .katex, .answer table",
	);
	for (const node of wide) node.style.zoom = "";
	for (const node of wide) {
		const box = node.parentElement;
		if (!box) continue;
		const style = getComputedStyle(box);
		const room =
			box.clientWidth -
			Number.parseFloat(style.paddingLeft) -
			Number.parseFloat(style.paddingRight);
		const need = node.scrollWidth;
		if (need > room + 1 && room > 0) node.style.zoom = String(room / need);
	}
}
