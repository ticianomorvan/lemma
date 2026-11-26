/**
 * A session's thread as a notebook: each exchange is a cell with the question
 * set apart as a card and the answer as full-width serif. The composer is
 * docked to the bottom edge, and stop floats above it while Claude answers.
 *
 * It fills whatever box it is given: the Practice notebook and the Read
 * view's chat panel are both this thread.
 */
import { ArrowDown, ArrowUp, FileText, Square } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { cn } from "#lib/utils.ts";
import type { Anchor, Attachment } from "../../shared/protocol.ts";
import { useLayout } from "../layout.ts";
import { Markdown } from "../markdown/lazy.tsx";
import { ModeCards } from "../modes/mode-cards.tsx";
import { PhonePopover } from "../photos/phone-popover.tsx";
import { CameraButton, PhotoStrip, SentPhotos } from "../photos/photos.tsx";
import type { SessionState } from "../store.ts";
import {
	type ComposerDraft,
	type ThreadPlace,
	useComposer,
	useStickToBottom,
	useStopOnEscape,
} from "./hooks.ts";
import {
	basename,
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
	onCite,
	composerTop,
	draft,
	place,
}: {
	state: SessionState;
	actions: ThreadActions;
	/** Opens an anchored question's passage; without it the citation is plain text. */
	onCite?: (anchor: Anchor) => void;
	/** Shown above the composer's text, such as the passage a question will quote. */
	composerTop?: ReactNode;
	/** The composer's text, kept by the session so it outlives this thread (switching views). */
	draft: ComposerDraft;
	/** Where the reader was, kept across mounts; without it the thread opens at the bottom. */
	place?: { current?: ThreadPlace };
}) {
	const running = isRunning(state.view);
	const items = threadItems(state);
	const phone = useLayout() === "phone";
	// Photos a message on its way already took don't wait any more: they
	// can't go out twice.
	const sending = new Set(
		state.outgoing.flatMap((m) =>
			m.failed ? [] : m.attachments.map((a) => a.id),
		),
	);
	const waiting = (state.view?.attachments ?? []).filter(
		(a) => !sending.has(a.id),
	);
	// Rows already there when the thread mounts appear at once; only new ones
	// animate in, so opening the thread (or switching to it) is instant.
	const [present] = useState(() => new Set(items.map(itemKey)));
	const scroller = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const { atBottom, scrollToBottom, pin } = useStickToBottom(
		scroller,
		content,
		place,
	);
	const composer = useComposer(
		{
			send: (text) => {
				pin();
				actions.send(
					text,
					waiting.map((a) => a.id),
				);
			},
		},
		draft,
		waiting.length > 0,
	);
	const camera = (variant: "icon" | "hero" | "tile", label?: string) => (
		<CameraButton
			variant={variant}
			onPhotos={actions.upload}
			{...(label ? { label } : {})}
		/>
	);
	const strip = (
		<PhotoStrip
			waiting={waiting}
			uploads={state.uploads}
			onDrop={actions.drop}
			onDismiss={actions.dismissUpload}
			more={phone ? camera("tile", "Sacar otra") : undefined}
		/>
	);
	const photos = waiting.length > 0 || state.uploads.length > 0;
	const meta = state.view?.meta;
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
				className="@container min-h-0 overflow-y-auto [scrollbar-gutter:stable]"
			>
				<IndexRail turns={turns} active={active} scroller={scroller} />
				<div
					ref={content}
					className="mx-auto max-w-[720px] px-4 pt-6 pb-16 sm:px-8 sm:pt-8"
				>
					{items.length === 0 && (
						<Empty
							modes={<ModeCards meta={meta} />}
							camera={
								phone && !photos
									? camera("hero", "Sacar foto del ejercicio")
									: undefined
							}
						/>
					)}
					{items.map((item, i) => (
						<Cell
							key={itemKey(item)}
							item={item}
							first={i === 0}
							animate={!present.has(itemKey(item))}
							onRetry={actions.send}
							onCite={onCite}
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
				{(composerTop || photos) && (
					<div className="mx-auto grid max-w-[720px] gap-2 px-4 pt-3 sm:px-8">
						{composerTop}
						{photos && strip}
					</div>
				)}
				<form
					className="mx-auto flex max-w-[720px] items-end gap-2 px-4 py-3 sm:px-8"
					onSubmit={(e) => {
						e.preventDefault();
						composer.submit();
					}}
				>
					{phone ? (
						camera("icon")
					) : (
						<PhonePopover
							session={state.view?.meta.id}
							waiting={waiting.length}
						/>
					)}
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
							running
								? "Anotá la próxima pregunta…"
								: photos
									? "Agregá un comentario…"
									: "Escribí una pregunta…"
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

function Empty({ camera, modes }: { camera?: ReactNode; modes?: ReactNode }) {
	return (
		<div className="grid gap-2 pt-[24dvh] text-center">
			<p className="font-heading text-2xl">¿Qué estudiamos hoy?</p>
			{camera ? (
				<>
					<p className="text-sm text-muted-foreground text-pretty">
						Sacale una foto a lo que resolviste en papel, o escribí una
						pregunta.
					</p>
					<div className="mt-4 flex justify-center">{camera}</div>
				</>
			) : (
				<p className="text-sm text-muted-foreground">
					Escribí fórmulas en LaTeX, como <code>$\int_0^1 x\,dx$</code>, y se
					ven renderizadas.
				</p>
			)}
			{modes}
		</div>
	);
}

function Cell({
	item,
	first,
	animate,
	onRetry,
	onEdit,
	onCite,
}: {
	item: ThreadItem;
	first: boolean;
	animate: boolean;
	onRetry: (text: string) => void;
	onEdit: (clientMsgId: string) => void;
	onCite?: (anchor: Anchor) => void;
}) {
	const divider = first ? "" : "border-t";
	if (item.kind !== "turn") {
		const text = item.kind === "queued" ? item.user.text : item.message.text;
		const photos =
			item.kind === "queued" ? item.user.attachments : item.message.attachments;
		const failed = item.kind === "outgoing" && item.message.failed;
		const label = failed
			? "No se envió"
			: item.kind === "queued"
				? `En cola${item.position > 1 ? ` · ${item.position}º` : ""}`
				: "Enviando";
		return (
			<section
				className={cn("border-dashed py-6", animate && "turn-in", divider)}
			>
				<Question
					text={text}
					photos={photos}
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
				"scroll-mt-4 py-6 outline-none",
				animate && "turn-in",
				divider,
				first && "pt-0",
			)}
		>
			<Question
				text={turn.user.text}
				photos={turn.user.attachments}
				anchor={turn.user.anchor}
				onCite={onCite}
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
	photos = [],
	label,
	tone,
	pending = false,
	anchor,
	onCite,
}: {
	text: string;
	photos?: Attachment[];
	label: string;
	tone: "muted" | "live" | "error";
	pending?: boolean;
	anchor?: Anchor;
	onCite?: (anchor: Anchor) => void;
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
			{anchor && <Citation anchor={anchor} onCite={onCite} />}
			<SentPhotos photos={photos} />
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

/**
 * The passage an anchored question quotes: the file and page, then the quote.
 * With `onCite` the whole citation is a button that opens the page there.
 */
export function Citation({
	anchor,
	onCite,
}: {
	anchor: Anchor;
	onCite?: (anchor: Anchor) => void;
}) {
	const body = (
		<>
			<span className="flex items-center gap-1.5 text-[12px] text-primary">
				<FileText aria-hidden className="size-3.5 shrink-0" />
				<span className="truncate">
					{basename(anchor.path)} · p. {anchor.page}
				</span>
			</span>
			<span className="mt-0.5 line-clamp-2 border-l-2 border-highlight pl-2 font-heading text-[14px] text-muted-foreground italic">
				{snippet(anchor.text)}
			</span>
		</>
	);
	return onCite ? (
		<button
			type="button"
			onClick={() => onCite(anchor)}
			aria-label={`Abrir ${basename(anchor.path)} en la página ${anchor.page}`}
			className="-mx-1.5 mb-2 grid w-[calc(100%+0.75rem)] rounded-md px-1.5 py-1 text-left transition-[background-color,transform] duration-150 ease-out hover:bg-secondary active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-ring"
		>
			{body}
		</button>
	) : (
		<div className="mb-2 grid py-1">{body}</div>
	);
}
