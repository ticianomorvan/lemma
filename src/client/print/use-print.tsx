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
import { titleText } from "../markdown/lazy.tsx";
import { PrintSession } from "./print-session.tsx";

/** Longest wait for the copy to draw before printing it anyway. */
const READY_TIMEOUT_MS = 20_000;

/**
 * What isn't drawn yet: a loading fallback marks itself `data-pending` (the
 * Markdown chunk, a diagram, a Vega chart inside one).
 */
const PENDING = "[data-pending]";

export function usePrint(view: SessionView | undefined) {
	const title = view && `${titleText(view.meta.title)} · ${view.meta.course}`;
	const [printing, setPrinting] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	/** The page's own title while the copy is mounted (the copy's is the PDF's file name). */
	const saved = useRef<string>(undefined);
	const busy = useRef<Promise<void>>(undefined);
	const titleRef = useRef(title);
	titleRef.current = title;

	/** Mounts and fits the copy; a no-op while it is mounted. */
	const mount = useCallback(() => {
		if (saved.current !== undefined) return;
		saved.current = document.title;
		flushSync(() => setPrinting(true));
		if (titleRef.current) document.title = titleRef.current;
		if (root.current) fit(root.current);
	}, []);

	/** Only the dialog closing unmounts it. */
	const unmount = useCallback(() => {
		if (saved.current === undefined) return;
		document.title = saved.current;
		saved.current = undefined;
		setPrinting(false);
	}, []);

	const print = useCallback(() => {
		busy.current ??= (async () => {
			// Nothing to print until the session's snapshot has arrived.
			if (!titleRef.current) return;
			mount();
			const el = root.current;
			if (!el) return unmount();
			try {
				await drawn(el);
			} catch {
				// Print what has drawn.
			}
			// A print from the browser's menu meanwhile already came and went.
			if (saved.current === undefined) return;
			fit(el);
			window.print();
		})().finally(() => {
			busy.current = undefined;
		});
		return busy.current;
	}, [mount, unmount]);

	useEffect(() => {
		// ⌘P on a Mac (Ctrl+P there moves up a line in a text field), Ctrl+P
		// elsewhere; the letter, whatever the keyboard layout.
		const mac = /Mac|iPhone|iPad/.test(navigator.platform);
		const onKey = (e: KeyboardEvent) => {
			const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
			if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "p") {
				e.preventDefault();
				void print();
			}
		};
		window.addEventListener("beforeprint", mount);
		window.addEventListener("afterprint", unmount);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("beforeprint", mount);
			window.removeEventListener("afterprint", unmount);
			window.removeEventListener("keydown", onKey);
		};
	}, [mount, unmount, print]);

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
	// Deferred renders (a Vega chart's measured width) run as tasks: let them start.
	await frame();
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
