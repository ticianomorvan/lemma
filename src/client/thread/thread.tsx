/**
 * A session's thread as a notebook: each exchange is a cell with the question
 * set apart as a card and the answer as full-width serif. The composer is
 * docked to the bottom edge, and stop floats above it while Claude answers.
 *
 * It fills whatever box it is given, so the same view can later sit in the
 * Read view's chat panel (step 8) and become the Practice notebook (step 9).
 */
import { ArrowDown, ArrowUp, Square } from "lucide-react";
import { useRef } from "react";
import { cn } from "#lib/utils.ts";
import { Markdown } from "../markdown/lazy.tsx";
import type { SessionState } from "../store.ts";
import { useComposer, useStickToBottom, useStopOnEscape } from "./hooks.ts";
import {
	cellId,
	isRunning,
	itemKey,
	snippet,
	type ThreadActions,
	type ThreadItem,
	threadItems,
} from "./model.ts";
import { TurnBlocks } from "./parts.tsx";
import { IndexRail, useActiveCell } from "./thread-index.tsx";

const STATUS: Record<string, string> = {
	streaming: "Respondiendo",
	interrupted: "Interrumpida",
	error: "Error",
};

export function Thread({
	state,
	actions,
}: {
	state: SessionState;
	actions: ThreadActions;
}) {
	const running = isRunning(state.view);
	const items = threadItems(state);
	const scroller = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const { atBottom, scrollToBottom, pin } = useStickToBottom(scroller, content);
	const composer = useComposer({
		send: (text) => {
			pin();
			actions.send(text);
		},
	});
	useStopOnEscape(running, actions.stop);
	const turns = items.filter((i) => i.kind === "turn");
	const active = useActiveCell(
		scroller,
		turns.map((t) => cellId(t.turn.id)),
	);

	return (
		<div className="relative grid h-full min-h-0 grid-rows-[1fr_auto] bg-paper">
			<div
				ref={scroller}
				className="min-h-0 overflow-y-auto [scrollbar-gutter:stable]"
			>
				<IndexRail turns={turns} active={active} scroller={scroller} />
				<div
					ref={content}
					className="mx-auto max-w-[720px] px-4 pt-6 pb-16 sm:px-8 sm:pt-8"
				>
					{items.length === 0 && <Empty />}
					{items.map((item, i) => (
						<Cell
							key={itemKey(item)}
							item={item}
							first={i === 0}
							onRetry={actions.send}
							onEdit={(id) => composer.restore(actions.discard(id))}
						/>
					))}
				</div>
			</div>
			<div className="relative border-t bg-card">
				<div className="pointer-events-none absolute inset-x-0 -top-12 flex justify-center gap-2">
					{running && (
						<button
							type="button"
							onClick={actions.stop}
							className="turn-in pointer-events-auto inline-flex h-8 items-center gap-2 rounded-full bg-foreground pr-2 pl-3 text-[13px] text-background shadow-lg transition-transform duration-150 ease-out active:scale-[0.97]"
						>
							<Square aria-hidden className="size-3 fill-current" />
							Detener
							<kbd className="rounded bg-background/15 px-1.5 font-sans text-[11px] max-sm:hidden">
								Esc
							</kbd>
						</button>
					)}
					{!atBottom && (
						<button
							type="button"
							onClick={scrollToBottom}
							aria-label="Ir al final"
							className="turn-in pointer-events-auto grid size-8 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm transition-transform duration-150 ease-out active:scale-[0.97]"
						>
							<ArrowDown aria-hidden className="size-4" />
						</button>
					)}
				</div>
				<form
					className="mx-auto flex max-w-[720px] items-end gap-2 px-4 py-3 sm:px-8"
					onSubmit={(e) => {
						e.preventDefault();
						composer.submit();
					}}
				>
					<label htmlFor="composer" className="sr-only">
						Mensaje
					</label>
					<textarea
						id="composer"
						ref={composer.ref}
						value={composer.text}
						onChange={(e) => composer.setText(e.target.value)}
						onKeyDown={composer.onKeyDown}
						rows={1}
						placeholder={
							running ? "Anotá la próxima pregunta…" : "Escribí una pregunta…"
						}
						className="field-sizing-content max-h-48 min-h-9 flex-1 resize-none bg-transparent py-1.5 font-heading text-[16px] leading-normal outline-none placeholder:text-subtle"
					/>
					<button
						type="submit"
						disabled={!composer.canSend}
						className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-[transform,opacity] duration-150 ease-out active:scale-[0.97] disabled:opacity-40"
					>
						<ArrowUp aria-hidden className="size-4" />
						<span className="max-sm:sr-only">
							{running ? "A la cola" : "Enviar"}
						</span>
					</button>
				</form>
			</div>
		</div>
	);
}

function Empty() {
	return (
		<div className="grid gap-2 pt-[24dvh] text-center">
			<p className="font-heading text-2xl">¿Qué estudiamos hoy?</p>
			<p className="text-sm text-muted-foreground">
				Escribí fórmulas en LaTeX, como <code>$\int_0^1 x\,dx$</code>, y se ven
				renderizadas.
			</p>
		</div>
	);
}

function Cell({
	item,
	first,
	onRetry,
	onEdit,
}: {
	item: ThreadItem;
	first: boolean;
	onRetry: (text: string) => void;
	onEdit: (clientMsgId: string) => void;
}) {
	const divider = first ? "" : "border-t";
	if (item.kind !== "turn") {
		const text = item.kind === "queued" ? item.user.text : item.message.text;
		const failed = item.kind === "outgoing" && item.message.failed;
		const label = failed
			? "No se envió"
			: item.kind === "queued"
				? `En cola${item.position > 1 ? ` · ${item.position}º` : ""}`
				: "Enviando";
		return (
			<section className={cn("turn-in border-dashed py-6", divider)}>
				<Question
					text={text}
					label={label}
					tone={failed ? "error" : "muted"}
					pending
				/>
				{failed && (
					<p className="mt-2 text-sm text-destructive">
						{item.message.failed}.{" "}
						<button
							type="button"
							className="text-primary underline underline-offset-2"
							onClick={() => onEdit(item.message.clientMsgId)}
						>
							Editar y reenviar
						</button>
					</p>
				)}
			</section>
		);
	}
	const { turn, state } = item;
	return (
		<section
			id={cellId(turn.id)}
			tabIndex={-1}
			aria-label={`Pregunta: ${snippet(turn.user.text).slice(0, 80)}`}
			className={cn(
				"turn-in scroll-mt-4 py-6 outline-none",
				divider,
				first && "pt-0",
			)}
		>
			<Question
				text={turn.user.text}
				label={STATUS[state] ?? ""}
				tone={
					state === "error" ? "error" : state === "streaming" ? "live" : "muted"
				}
			/>
			<div className="mt-5 [&_.answer]:text-[16px]">
				<TurnBlocks turn={turn} streaming={state === "streaming"} />
			</div>
			{state === "interrupted" && (
				<p className="mt-3 text-[13px] text-subtle">
					Detenida antes de terminar.
				</p>
			)}
			{state === "error" && (
				<div
					role="alert"
					className="mt-4 border-l-2 border-destructive pl-3 text-sm"
				>
					<p>No se pudo terminar la respuesta.</p>
					{item.error && (
						<p
							className="truncate font-mono text-xs text-muted-foreground"
							title={item.error}
						>
							{item.error}
						</p>
					)}
					<button
						type="button"
						onClick={() => onRetry(turn.user.text)}
						className="mt-1 text-primary underline underline-offset-2"
					>
						Volver a preguntar
					</button>
				</div>
			)}
		</section>
	);
}

/**
 * The student's question: a card on the paper, so each exchange is easy to
 * find when scrolling through long answers. Math in it renders too.
 */
function Question({
	text,
	label,
	tone,
	pending = false,
}: {
	text: string;
	label: string;
	tone: "muted" | "live" | "error";
	pending?: boolean;
}) {
	return (
		<div
			className={cn(
				"rounded-xl border bg-card px-4 py-3 shadow-sm",
				pending && "border-dashed bg-transparent shadow-none",
			)}
		>
			<div className="mb-1 flex h-4 items-center gap-2 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">
				<span>Vos</span>
				{label && (
					<>
						<span aria-hidden>·</span>
						<span
							className={cn(
								tone === "live" && "text-primary",
								tone === "error" && "text-destructive",
							)}
						>
							{label}
						</span>
					</>
				)}
			</div>
			<div
				className={cn(
					"answer question text-[15px] font-medium",
					pending && "text-muted-foreground",
				)}
			>
				<Markdown text={text} question />
			</div>
		</div>
	);
}
