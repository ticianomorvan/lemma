import {
	type KeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { ThreadActions } from "./model.ts";

const coarse = () =>
	typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/** A composer's text kept outside it, so it outlives the composer. */
export type ComposerDraft = { text: string; setText: (text: string) => void };

/**
 * Composer state and keys: Enter sends (a newline on touch screens) and
 * Shift+Enter is a newline. Sending while Claude answers queues the message.
 * With `draft` the text lives there instead, so a session's views share it.
 */
export function useComposer(
	actions: Pick<ThreadActions, "send">,
	draft?: ComposerDraft,
) {
	const own = useState("");
	const [text, setText] = draft ? [draft.text, draft.setText] : own;
	const ref = useRef<HTMLTextAreaElement>(null);
	const canSend = text.trim().length > 0;
	const submit = useCallback(() => {
		if (!text.trim()) return;
		actions.send(text.trim());
		setText("");
		ref.current?.focus();
	}, [text, actions, setText]);
	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.nativeEvent.isComposing) return;
		if (e.key === "Enter" && !e.shiftKey && !coarse()) {
			e.preventDefault();
			submit();
		}
	};
	const restore = (value: string) => {
		setText(value);
		ref.current?.focus();
	};
	return { text, setText, ref, canSend, submit, onKeyDown, restore };
}

/**
 * Esc stops a running answer, from the composer or anywhere on the page, but
 * not while a popup (such as the index) is open: there Esc closes the popup.
 */
export function useStopOnEscape(running: boolean, stop: () => void) {
	useEffect(() => {
		if (!running) return;
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented) return;
			if (document.querySelector('[role="dialog"], [data-popup-open]')) return;
			stop();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [running, stop]);
}

// ── Scrolling ────────────────────────────────────────────────────────────────

/**
 * Where a reader left a thread: at the bottom, or with a cell's top `offset`
 * px below the view's top. Kept by cell rather than pixels, so answers that
 * draw at a different height on the way back don't move the reader.
 */
export type ThreadPlace = { cell?: string; offset: number };

/**
 * Keeps a scroll container pinned to the bottom while content grows, as long
 * as the reader is already there. Scrolling up releases it.
 *
 * With `memory`, the reader's place is written there as they scroll and the
 * next mount opens at it instead of at the bottom.
 */
export function useStickToBottom(
	scroller: RefObject<HTMLElement | null>,
	content: RefObject<HTMLElement | null>,
	memory?: { current?: ThreadPlace },
) {
	const [atBottom, setAtBottom] = useState(() => !memory?.current?.cell);
	const pinned = useRef(true);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `memory` is read once, at mount
	useLayoutEffect(() => {
		const el = scroller.current;
		const inner = content.current;
		if (!el || !inner) return;
		const cell = memory?.current?.cell;
		const target = cell ? document.getElementById(cell) : null;
		if (target && el.contains(target)) {
			el.scrollTop +=
				target.getBoundingClientRect().top -
				el.getBoundingClientRect().top -
				(memory?.current?.offset ?? 0);
			pinned.current = false;
		} else el.scrollTop = el.scrollHeight;
		let last = el.scrollTop;
		let frame = 0;
		const remember = () => {
			frame = 0;
			if (memory) memory.current = placeIn(el, pinned.current);
		};
		const onScroll = () => {
			const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
			// Only the reader scrolling up releases the pin; a smooth scroll
			// down (ours, toward the end) passes through "not near" frames.
			if (near) pinned.current = true;
			else if (el.scrollTop < last) pinned.current = false;
			last = el.scrollTop;
			setAtBottom(near);
			frame ||= requestAnimationFrame(remember);
		};
		const observer = new ResizeObserver(() => {
			if (pinned.current) el.scrollTop = el.scrollHeight;
		});
		observer.observe(inner);
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			observer.disconnect();
			el.removeEventListener("scroll", onScroll);
			cancelAnimationFrame(frame);
		};
	}, [scroller, content]);

	const scrollToBottom = useCallback(() => {
		const el = scroller.current;
		if (!el) return;
		pinned.current = true;
		el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
	}, [scroller]);

	return { atBottom, scrollToBottom, pin: () => (pinned.current = true) };
}

/** The first cell whose bottom is in view, and how far its top sits below the view's top. */
function placeIn(el: HTMLElement, pinned: boolean): ThreadPlace {
	if (pinned) return { offset: 0 };
	const top = el.getBoundingClientRect().top;
	for (const cell of el.querySelectorAll<HTMLElement>("section[id]")) {
		const box = cell.getBoundingClientRect();
		if (box.bottom > top) return { cell: cell.id, offset: box.top - top };
	}
	return { offset: 0 };
}
