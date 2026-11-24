/**
 * Selecting text on a page offers "Preguntar · Nota" in a floating bar over
 * the selection (below it on a touch screen, clear of the system's own menu).
 */
import { MessageSquarePlus, StickyNote } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { cn } from "#lib/utils.ts";
import type { Anchor } from "../../shared/protocol.ts";
import { pageOf } from "./anchors.ts";

type Pending = { anchor: Anchor; range: Range; rect: DOMRect };

/** Longer quotes are cut here; the protocol takes up to 10 000 characters. */
const MAX_QUOTE = 4000;

export function SelectionActions({
	root,
	path,
	onAsk,
	onNote,
}: {
	root: RefObject<HTMLElement | null>;
	/** The open file, relative to the study root. */
	path: string;
	onAsk: (anchor: Anchor, range: Range) => void;
	onNote: (anchor: Anchor, range: Range) => void;
}) {
	const [pending, setPending] = useState<Pending>();

	useEffect(() => {
		let frame = 0;
		const read = () => {
			frame = 0;
			const sel = getSelection();
			const text = sel?.toString().replace(/\s+/g, " ").trim();
			if (!sel || !text || sel.rangeCount === 0) return setPending(undefined);
			const range = sel.getRangeAt(0);
			// The page the selection starts on; a quote that runs onto the next
			// page still belongs to the first.
			const page = root.current && pageOf(range.startContainer, root.current);
			if (!page) return setPending(undefined);
			setPending({
				anchor: {
					path,
					page,
					text: text.slice(0, MAX_QUOTE),
				},
				range: range.cloneRange(),
				rect: range.getBoundingClientRect(),
			});
		};
		const onChange = () => {
			frame ||= requestAnimationFrame(read);
		};
		const onScroll = () => setPending(undefined);
		document.addEventListener("selectionchange", onChange);
		const el = root.current;
		el?.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			document.removeEventListener("selectionchange", onChange);
			el?.removeEventListener("scroll", onScroll);
			cancelAnimationFrame(frame);
		};
	}, [root, path]);

	if (!pending) return null;
	const touch = matchMedia("(pointer: coarse)").matches;
	const { rect } = pending;
	const top = touch ? rect.bottom + 10 : rect.top - 44;
	const left = Math.min(
		Math.max(8, rect.left + rect.width / 2 - 96),
		innerWidth - 200,
	);
	const act = (fn: typeof onAsk) => () => {
		fn(pending.anchor, pending.range);
		getSelection()?.removeAllRanges();
		setPending(undefined);
	};
	const button =
		"inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-[background-color,transform] duration-150 ease-out hover:bg-background/15 active:scale-[0.97]";
	return (
		<div
			role="toolbar"
			aria-label="Selección"
			style={{ top: Math.max(8, top), left }}
			className={cn(
				"select-pop fixed z-40 flex items-center gap-0.5 rounded-full bg-foreground p-1 text-background shadow-lg",
				touch ? "origin-top" : "origin-bottom",
			)}
			// Keep the selection while pressing.
			onPointerDown={(e) => e.preventDefault()}
		>
			<button type="button" onClick={act(onAsk)} className={button}>
				<MessageSquarePlus aria-hidden className="size-4" />
				Preguntar
			</button>
			<button type="button" onClick={act(onNote)} className={button}>
				<StickyNote aria-hidden className="size-4" />
				Nota
			</button>
		</div>
	);
}
