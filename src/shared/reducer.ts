/**
 * Folds session events into the view state. The server keeps its snapshot with
 * this reducer and clients rebuild theirs with it, so both agree by
 * construction. Pure and immutable: unchanged parts keep their identity, which
 * React's `useSyncExternalStore` relies on.
 */
import type {
	Block,
	SessionEvent,
	SessionMeta,
	SessionView,
	Turn,
} from "./protocol.ts";

export function emptyView(meta: SessionMeta): SessionView {
	return {
		status: "idle",
		meta,
		turns: [],
		queue: [],
		notes: [],
		attachments: [],
	};
}

export function reduce(
	view: SessionView,
	events: Iterable<SessionEvent>,
): SessionView {
	let next = view;
	for (const event of events) next = apply(next, event);
	return next;
}

export function apply(view: SessionView, e: SessionEvent): SessionView {
	switch (e.type) {
		case "user_message": {
			const { type: _, queued: __, ...user } = e;
			const sent = new Set(user.attachments.map((a) => a.id));
			return {
				...view,
				queue: [...view.queue, user],
				attachments:
					sent.size === 0
						? view.attachments
						: view.attachments.filter((a) => !sent.has(a.id)),
			};
		}
		case "attachments":
			return { ...view, attachments: e.pending };
		case "note": {
			const { type: _, ...note } = e;
			return { ...view, notes: [...view.notes, note] };
		}
		case "turn_start": {
			const user = view.queue.find((m) => m.turnId === e.turnId);
			if (!user) return view;
			// A new turn clears the previous turn's error.
			const { error: _, ...rest } = view;
			return {
				...rest,
				status: "running",
				queue: view.queue.filter((m) => m !== user),
				inflight: { id: e.turnId, user, blocks: [] },
			};
		}
		case "block_start":
			return withBlocks(view, (blocks) => [
				...blocks,
				{
					id: e.id,
					kind: e.kind,
					...(e.name === undefined ? {} : { name: e.name }),
					text: "",
					done: false,
				},
			]);
		case "delta":
			return withBlock(view, e.id, (b) => ({ ...b, text: b.text + e.text }));
		case "block_end":
			return withBlock(view, e.id, (b) => ({ ...b, done: true }));
		case "tool_result":
			return withBlock(view, e.id, (b) => ({
				...b,
				result: { ok: e.ok, summary: e.summary },
			}));
		case "turn_end": {
			const turn = view.inflight;
			if (!turn || turn.id !== e.turnId) return view;
			const ended: Turn = {
				...turn,
				blocks: turn.blocks.map((b) => (b.done ? b : { ...b, done: true })),
				end: { reason: e.reason, usage: e.usage },
			};
			const { inflight: _, ...rest } = view;
			return { ...rest, status: "idle", turns: [...view.turns, ended] };
		}
		case "meta":
			return { ...view, meta: e.meta };
		case "error": {
			const { type: _, ...error } = e;
			return { ...view, error };
		}
	}
}

function withBlocks(
	view: SessionView,
	update: (blocks: Block[]) => Block[],
): SessionView {
	if (!view.inflight) return view;
	return {
		...view,
		inflight: { ...view.inflight, blocks: update(view.inflight.blocks) },
	};
}

function withBlock(
	view: SessionView,
	id: string,
	update: (block: Block) => Block,
): SessionView {
	return withBlocks(view, (blocks) =>
		blocks.map((b) => (b.id === id ? update(b) : b)),
	);
}
