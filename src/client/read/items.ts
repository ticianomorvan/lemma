/**
 * What the margin and the gutter show: one item per anchored question or
 * note on the open file, grouped by the passage they quote.
 */
import type { Anchor, Note, SessionView, Turn } from "../../shared/protocol.ts";
import { passageKey } from "./anchors.ts";

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

/** The anchored turns and notes on `path`, turns first, in thread order. */
export function marginItems(view: SessionView | undefined, path: string) {
	if (!view) return [];
	const turns = view.inflight ? [...view.turns, view.inflight] : view.turns;
	const items: Item[] = [];
	turns.forEach((turn, i) => {
		const anchor = turn.user.anchor;
		if (anchor?.path !== path) return;
		items.push({
			kind: "turn",
			key: turn.id,
			n: i + 1,
			anchor,
			turn,
			streaming: turn === view.inflight,
		});
	});
	for (const note of view.notes) {
		if (note.anchor.path !== path) continue;
		items.push({ kind: "note", key: note.id, anchor: note.anchor, note });
	}
	return items;
}

export function groups(items: Item[]): Group[] {
	const map = new Map<string, Group>();
	for (const item of items) {
		const key = passageKey(item.anchor);
		const group = map.get(key) ?? { key, anchor: item.anchor, items: [] };
		group.items.push(item);
		map.set(key, group);
	}
	return [...map.values()];
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
