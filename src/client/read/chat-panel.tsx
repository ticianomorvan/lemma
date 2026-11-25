/**
 * Read's chat: the session thread beside the page (or in a sheet on a
 * phone), and the button that opens it.
 */
import { MessagesSquare, PanelRightClose, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { cn } from "#lib/utils.ts";
import type { Anchor } from "../../shared/protocol.ts";
import type { SessionState, SessionStore } from "../store.ts";
import type { ComposerDraft } from "../thread/hooks.ts";
import { cellId, type ThreadActions } from "../thread/model.ts";
import { Citation, Thread } from "../thread/thread.tsx";
import { revealAnchor } from "./anchors.ts";

/** The thread beside the page, with the passage a question will quote above the composer. */
export function ChatPanel({
	store,
	state,
	pending,
	onPendingClear,
	target,
	onClose,
	closeIcon = "panel",
	draft,
}: {
	store: SessionStore;
	state: SessionState;
	pending?: Anchor;
	onPendingClear: () => void;
	/** A turn to bring into view: set by a pin or a card. `n` changes on each request. */
	target?: { turnId: string; n: number };
	onClose: () => void;
	/** `panel` where it sits beside the page, `x` where it covers it. */
	closeIcon?: "panel" | "x";
	/** The composer's text, shared with Practice. */
	draft?: ComposerDraft;
}) {
	const actions = useMemo<ThreadActions>(
		() => ({
			send: (text) => {
				void store.send(text, pending);
				onPendingClear();
			},
			stop: () => void store.interrupt(),
			discard: (clientMsgId) => store.discard(clientMsgId),
		}),
		[store, pending, onPendingClear],
	);

	useEffect(() => {
		if (!target) return;
		// After the thread's own first scroll to the bottom.
		const frame = requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				const cell = document.getElementById(cellId(target.turnId));
				if (!cell) return;
				const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
				cell.scrollIntoView({
					block: "start",
					behavior: reduce ? "auto" : "smooth",
				});
				cell.focus({ preventScroll: true });
				cell.setAttribute("data-flash", "");
				setTimeout(() => cell.removeAttribute("data-flash"), 1200);
			}),
		);
		return () => cancelAnimationFrame(frame);
	}, [target]);

	useEffect(() => {
		if (pending) document.getElementById("composer")?.focus();
	}, [pending]);

	const view = state.view;
	const count = (view?.turns.length ?? 0) + (view?.inflight ? 1 : 0);
	return (
		<section
			aria-label="Chat"
			className="grid h-full min-h-0 grid-rows-[40px_minmax(0,1fr)] bg-paper"
		>
			<div className="flex items-center gap-2 border-b bg-card px-3 text-[13px]">
				<MessagesSquare aria-hidden className="size-4 text-subtle" />
				<span className="font-medium">Chat</span>
				<span className="text-subtle">
					{count} {count === 1 ? "pregunta" : "preguntas"}
				</span>
				<span className="flex-1" />
				<button
					type="button"
					onClick={onClose}
					aria-label="Cerrar el chat"
					className="grid size-8 place-items-center rounded-md text-muted-foreground transition-[color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.97]"
				>
					{closeIcon === "panel" ? (
						<PanelRightClose aria-hidden className="size-4" />
					) : (
						<X aria-hidden className="size-4" />
					)}
				</button>
			</div>
			<Thread
				state={state}
				actions={actions}
				onCite={revealAnchor}
				draft={draft}
				composerTop={
					pending && (
						<div className="flex items-start gap-1 rounded-lg bg-secondary px-2 pt-1">
							<div className="min-w-0 flex-1">
								<Citation anchor={pending} />
							</div>
							<button
								type="button"
								onClick={onPendingClear}
								aria-label="Quitar la cita"
								className="mt-1 grid size-7 shrink-0 place-items-center rounded-md text-subtle hover:text-foreground"
							>
								<X aria-hidden className="size-3.5" />
							</button>
						</div>
					)
				}
			/>
		</section>
	);
}

export function ChatButton({
	open,
	onClick,
	count,
	className,
}: {
	open: boolean;
	onClick: () => void;
	count: number;
	className?: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={open}
			className={cn(
				"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[13px] text-muted-foreground transition-[transform,color,border-color] duration-150 ease-out hover:border-input hover:text-foreground active:scale-[0.97] aria-pressed:border-input aria-pressed:bg-secondary aria-pressed:text-foreground",
				className,
			)}
		>
			<MessagesSquare aria-hidden className="size-4" />
			Chat
			<span className="rounded-full bg-secondary px-1.5 text-[11px] text-subtle tabular-nums">
				{count}
			</span>
		</button>
	);
}
