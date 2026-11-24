/**
 * What the margin and the gutter show: one item per anchored question or
 * note, grouped by the passage they quote, with where that passage sits.
 */
import type { Anchor, Note, Turn } from "../../../shared/protocol.ts";
import type { SessionState } from "../../store.ts";
import { passageOf } from "./fixture.ts";
import { rangeOf, selectionKey } from "./page.tsx";

export type Item =
	| {
			kind: "turn";
			key: string;
			/** The question's number in the thread, as the index numbers it. */
			n: number;
			anchor: Anchor;
			turn: Turn;
			streaming: boolean;
	  }
	| { kind: "note"; key: string; anchor: Anchor; note: Note };

export type Group = { key: string; anchor: Anchor; items: Item[] };

/** The passage key an anchor groups under. */
export const groupKey = (anchor: Anchor) =>
	passageOf(anchor)?.id ?? selectionKey(anchor);

export function marginItems(state: SessionState, notes: Note[]): Item[] {
	const view = state.view;
	if (!view) return [];
	const turns = view.inflight ? [...view.turns, view.inflight] : view.turns;
	const items: Item[] = [];
	turns.forEach((turn, i) => {
		const anchor = turn.user.anchor;
		if (!anchor) return;
		items.push({
			kind: "turn",
			key: turn.id,
			n: i + 1,
			anchor,
			turn,
			streaming: turn === view.inflight,
		});
	});
	for (const note of notes) {
		items.push({ kind: "note", key: note.id, anchor: note.anchor, note });
	}
	return items;
}

export function groups(items: Item[]): Group[] {
	const map = new Map<string, Group>();
	for (const item of items) {
		const key = groupKey(item.anchor);
		const group = map.get(key) ?? { key, anchor: item.anchor, items: [] };
		group.items.push(item);
		map.set(key, group);
	}
	return [...map.values()];
}

/** The passage's box on screen: its highlight, or the selection it came from. */
export function anchorRect(anchor: Anchor): DOMRect | undefined {
	const passage = passageOf(anchor);
	if (passage) {
		return document
			.querySelector(`[data-passage="${passage.id}"]`)
			?.getBoundingClientRect();
	}
	return rangeOf(anchor)?.getBoundingClientRect();
}

/** The first text block's first paragraph: a card's preview. */
export function preview(turn: Turn) {
	const text = turn.blocks.find((b) => b.kind === "text")?.text ?? "";
	return text.split(/\n\n/)[0] ?? "";
}

/**
 * Stacks boxes down a column: each sits at its wanted top unless the one
 * above reaches past it, then just below that one.
 */
export function stack(
	wants: { key: string; top: number; height: number }[],
	gap: number,
): Map<string, number> {
	const out = new Map<string, number>();
	let floor = Number.NEGATIVE_INFINITY;
	for (const w of wants.toSorted((a, b) => a.top - b.top)) {
		const y = Math.max(w.top, floor);
		out.set(w.key, y);
		floor = y + w.height + gap;
	}
	return out;
}

/** Scrolls a page's passage into view and flashes it. */
export function revealAnchor(anchor: Anchor) {
	const passage = passageOf(anchor);
	const el = passage
		? document.querySelector<HTMLElement>(`[data-passage="${passage.id}"]`)
		: document.querySelector<HTMLElement>(`[data-page="${anchor.page}"]`);
	if (!el) return;
	const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
	el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
	if (!passage) return;
	el.removeAttribute("data-flash");
	// Restart the animation on a second click.
	void el.offsetWidth;
	el.setAttribute("data-flash", "");
	setTimeout(() => el.removeAttribute("data-flash"), 1200);
}
