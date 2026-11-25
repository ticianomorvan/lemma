/**
 * Where anchors sit on the rendered PDF. The page renderer (`pdf-pages.tsx`)
 * draws each page with pdf.js's text layer and reports here when a layer is
 * ready; an anchor's quote is then found in its page's text layer as a DOM
 * Range. Everything that needs a passage's place on screen (the margin, the
 * pins, the highlights, a click on a highlight) asks this module, so only it
 * knows the page's markup.
 *
 * Quotes are matched ignoring whitespace: the text layer splits lines into
 * spans and line breaks, and a selection's text joins them with spaces or
 * newlines.
 */
import type { Anchor } from "../../shared/protocol.ts";

/** The element that holds the open PDF's pages. */
const ROOT = "[data-pdf]";

const pageSelector = (page: number) => `${ROOT} [data-page="${page}"]`;

/** Marks the element that scrolls the pages; `revealAnchor` scrolls it. */
export const SCROLLER = { "data-pdf-scroller": "" } as const;

/**
 * The part of a selection on the page it starts on: a quote that runs onto
 * the next page is cut at the end of the first, so it can be found there.
 */
export function clipToPage(range: Range): Range {
	const start = range.startContainer;
	const el = start instanceof Element ? start : start.parentElement;
	const layer = el?.closest(`${ROOT} [data-page] .textLayer`);
	if (!layer || layer.contains(range.endContainer)) return range;
	// The last text on the page, not the layer's end marker below it.
	const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
	let last: Text | null = null;
	for (let n = walker.nextNode(); n; n = walker.nextNode()) last = n as Text;
	if (!last) return range;
	const clipped = range.cloneRange();
	clipped.setEnd(last, last.data.length);
	return clipped;
}

/** The page a DOM node sits on, if it is on the open PDF inside `root`. */
export function pageOf(node: Node, root: Element): number | undefined {
	const el = node instanceof Element ? node : node.parentElement;
	const page = el?.closest<HTMLElement>(`${ROOT} [data-page]`);
	return page && root.contains(page) ? Number(page.dataset.page) : undefined;
}

// ── Text layers ──────────────────────────────────────────────────────────────

let version = 0;
const listeners = new Set<() => void>();
const ranges = new Map<string, Range | null>();

/** Called by the page renderer whenever a page's text layer (re)renders or goes. */
export function layersChanged() {
	version += 1;
	ranges.clear();
	for (const listener of listeners) listener();
}

/** For `useSyncExternalStore`: changes whenever any text layer does. */
export const layers = {
	subscribe(listener: () => void) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	version: () => version,
};

// ── Anchors ──────────────────────────────────────────────────────────────────

const key = (anchor: Anchor) =>
	`${anchor.path}\n${anchor.page}\n${anchor.text}`;

/** The passage key an anchor groups under: the same quote on the same page. */
export const passageKey = (anchor: Anchor) =>
	`${anchor.path}#${anchor.page}:${anchor.text.replace(/\s+/g, "")}`;

/** The anchor's quote on its page, once that page's text layer is drawn. */
export function anchorRange(anchor: Anchor): Range | undefined {
	const k = key(anchor);
	if (!ranges.has(k)) {
		const layer = document.querySelector(
			`${pageSelector(anchor.page)} .textLayer`,
		);
		ranges.set(k, layer ? findText(layer, anchor.text) : null);
	}
	return ranges.get(k) ?? undefined;
}

/** The passage's box on screen. */
export const anchorRect = (anchor: Anchor) =>
	anchorRange(anchor)?.getBoundingClientRect();

/**
 * Finds `text` in an element's text, ignoring whitespace, as a Range over
 * its text nodes.
 */
export function findText(root: Element, text: string): Range | null {
	const target = text.replace(/\s+/g, "");
	if (!target) return null;
	const chars: string[] = [];
	const at: [Text, number][] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const data = (node as Text).data;
		for (let i = 0; i < data.length; i += 1) {
			const ch = data[i] ?? "";
			if (/\s/.test(ch)) continue;
			chars.push(ch);
			at.push([node as Text, i]);
		}
	}
	const start = chars.join("").indexOf(target);
	if (start < 0) return null;
	const first = at[start];
	const last = at[start + target.length - 1];
	if (!first || !last) return null;
	const range = document.createRange();
	range.setStart(first[0], first[1]);
	range.setEnd(last[0], last[1] + 1);
	return range;
}

/** Whether a point is on the range's text (any of its line boxes). */
export function rangeHas(range: Range, x: number, y: number) {
	for (const r of range.getClientRects()) {
		if (x >= r.left && x <= r.right && y >= r.top - 2 && y <= r.bottom + 2) {
			return true;
		}
	}
	return false;
}

// ── Highlights ───────────────────────────────────────────────────────────────

/**
 * Paints passages with the CSS Custom Highlight API: questions fill their
 * passage, notes underline it, and the active one is stronger. Each call
 * replaces every highlight, so a passage whose turn or note is gone is no
 * longer painted.
 */
export function paint(groups: {
	questions: Range[];
	notes: Range[];
	active: Range[];
}) {
	if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
	const set = (name: string, list: Range[] = []) => {
		if (list.length) CSS.highlights.set(name, new Highlight(...list));
		else CSS.highlights.delete(name);
	};
	set("lemma-question", groups.questions);
	set("lemma-note", groups.notes);
	set("lemma-active", groups.active);
}

/** Scrolls an anchor's page, or its passage once drawn, into view and flashes it. */
export function revealAnchor(anchor: Anchor) {
	const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const behavior = reduce ? "auto" : "smooth";
	const range = anchorRange(anchor);
	const page = document.querySelector<HTMLElement>(pageSelector(anchor.page));
	if (!range) {
		page?.scrollIntoView({ block: "start", behavior });
		return;
	}
	const scroller = page?.closest<HTMLElement>("[data-pdf-scroller]");
	const rect = range.getBoundingClientRect();
	if (scroller) {
		const box = scroller.getBoundingClientRect();
		scroller.scrollTo({
			top:
				scroller.scrollTop +
				rect.top -
				box.top -
				(box.height - rect.height) / 2,
			behavior,
		});
	}
	flash(range);
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;
function flash(range: Range) {
	if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
	clearTimeout(flashTimer);
	CSS.highlights.set("lemma-flash", new Highlight(range));
	flashTimer = setTimeout(() => CSS.highlights.delete("lemma-flash"), 1200);
}
