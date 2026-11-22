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

/**
 * Composer state and keys: Enter sends (a newline on touch screens) and
 * Shift+Enter is a newline. Sending while Claude answers queues the message.
 */
export function useComposer(actions: Pick<ThreadActions, "send">) {
	const [text, setText] = useState("");
	const ref = useRef<HTMLTextAreaElement>(null);
	const canSend = text.trim().length > 0;
	const submit = useCallback(() => {
		if (!text.trim()) return;
		actions.send(text.trim());
		setText("");
		ref.current?.focus();
	}, [text, actions]);
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
 * Keeps a scroll container pinned to the bottom while content grows, as long
 * as the reader is already there. Scrolling up releases it.
 */
export function useStickToBottom(
	scroller: RefObject<HTMLElement | null>,
	content: RefObject<HTMLElement | null>,
) {
	const [atBottom, setAtBottom] = useState(true);
	const pinned = useRef(true);

	useLayoutEffect(() => {
		const el = scroller.current;
		const inner = content.current;
		if (!el || !inner) return;
		el.scrollTop = el.scrollHeight;
		let last = el.scrollTop;
		const onScroll = () => {
			const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
			// Only the reader scrolling up releases the pin; a smooth scroll
			// down (ours, toward the end) passes through "not near" frames.
			if (near) pinned.current = true;
			else if (el.scrollTop < last) pinned.current = false;
			last = el.scrollTop;
			setAtBottom(near);
		};
		const observer = new ResizeObserver(() => {
			if (pinned.current) el.scrollTop = el.scrollHeight;
		});
		observer.observe(inner);
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			observer.disconnect();
			el.removeEventListener("scroll", onScroll);
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
