/**
 * A session with no server: the fixture thread, plus an answer that streams in
 * a few characters at a time so the streaming states can be judged. Sending
 * or noting works the way the real store will (step 8), but stays in memory.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Anchor, Note, Turn } from "../../../shared/protocol.ts";
import type { SessionState } from "../../store.ts";
import type { ThreadActions } from "../../thread/model.ts";
import {
	CANNED,
	newNoteId,
	STREAMING,
	seedNotes,
	seedTurns,
	turnFrom,
} from "./fixture.ts";

type Live = { turn: Turn; full: string; shown: number };

/** Characters per tick and the tick, about the speed of a real answer. */
const STEP = 5;
const TICK_MS = 45;

export type FakeSession = {
	state: SessionState;
	notes: Note[];
	/** Sends a question, quoting `anchor` when given. */
	ask: (text: string, anchor?: Anchor) => void;
	note: (anchor: Anchor, text?: string) => void;
	actions: ThreadActions;
};

export function useFakeSession(): FakeSession {
	const [turns, setTurns] = useState(seedTurns);
	const [notes, setNotes] = useState(seedNotes);
	const [live, setLive] = useState<Live | undefined>(() => start(STREAMING));
	const liveRef = useRef(live);
	liveRef.current = live;

	useEffect(() => {
		if (!live) return;
		const timer = setTimeout(() => {
			const shown = Math.min(live.full.length, live.shown + STEP);
			if (shown >= live.full.length) {
				setTurns((t) => [...t, finish(live.turn, live.full, "completed")]);
				setLive(undefined);
			} else setLive({ ...live, shown });
		}, TICK_MS);
		return () => clearTimeout(timer);
	}, [live]);

	const ask = useCallback((text: string, anchor?: Anchor) => {
		const current = liveRef.current;
		if (current) {
			setTurns((t) => [...t, finish(current.turn, current.full, "completed")]);
		}
		setLive(start({ q: text, answer: CANNED }, anchor));
	}, []);

	const stop = useCallback(() => {
		const current = liveRef.current;
		if (!current) return;
		setTurns((t) => [
			...t,
			finish(current.turn, current.full.slice(0, current.shown), "interrupted"),
		]);
		setLive(undefined);
	}, []);

	const note = useCallback((anchor: Anchor, text?: string) => {
		setNotes((n) => [
			...n,
			{ id: newNoteId(), anchor, ...(text ? { text } : {}) },
		]);
	}, []);

	const state = useMemo<SessionState>(() => {
		const inflight =
			live && withText(live.turn, live.full.slice(0, live.shown));
		return {
			connection: "live",
			outgoing: [],
			view: {
				status: live ? "running" : "idle",
				meta: {
					id: "prototipo",
					course: "logica",
					title: "Deducción natural",
					created: "2026-11-24",
				},
				turns,
				...(inflight ? { inflight } : {}),
				queue: [],
				notes,
			},
		};
	}, [turns, notes, live]);

	const actions = useMemo<ThreadActions>(
		() => ({ send: (text) => ask(text), stop, discard: () => "" }),
		[ask, stop],
	);

	return { state, notes, ask, note, actions };
}

function start(
	seed: { q: string; answer: string; anchor?: string },
	anchor?: Anchor,
): Live {
	return { turn: turnFrom(seed, anchor, false), full: seed.answer, shown: 0 };
}

function withText(turn: Turn, text: string): Turn {
	return {
		...turn,
		blocks: turn.blocks.map((b) => (b.kind === "text" ? { ...b, text } : b)),
	};
}

function finish(
	turn: Turn,
	text: string,
	reason: "completed" | "interrupted",
): Turn {
	const t = withText(turn, text);
	return {
		...t,
		blocks: t.blocks.map((b) => ({ ...b, done: true })),
		end: { reason, usage: { inputTokens: 0, outputTokens: 0 } },
	};
}
