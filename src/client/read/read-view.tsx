/**
 * Read: the course PDF in the centre, with the session's anchored questions
 * and notes beside their passages (docs/architecture.md → Views, the design
 * step 7 chose, *Capas*).
 *
 * - Chat closed: margin cards, one per passage. Chat open: the cards fold
 *   into bars in the left gutter, and the panel covers the margin (desktop)
 *   or pushes the page aside (tablet).
 * - Phone: a strip of the visible page's cards along the bottom, and the
 *   chat as a bottom sheet.
 * - Selecting text offers Ask (a question quoting it) and Note.
 */
import "./read.css";
import {
	ChevronDown,
	FileText,
	MessagesSquare,
	PanelRightClose,
	X,
} from "lucide-react";
import {
	lazy,
	type ReactNode,
	type RefObject,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#components/ui/popover.tsx";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "#components/ui/sheet.tsx";
import { cn } from "#lib/utils.ts";
import type { Anchor, MaterialsResponse } from "../../shared/protocol.ts";
import type { Layout } from "../layout.ts";
import type { SessionState, SessionStore } from "../store.ts";
import {
	basename,
	cellId,
	snippet,
	type ThreadActions,
} from "../thread/model.ts";
import { Citation, Thread } from "../thread/thread.tsx";
import { anchorRange, revealAnchor } from "./anchors.ts";
import { type Group, groups as groupsOf, marginItems } from "./items.ts";
import { type Draft, Gutter, Margin } from "./margin.tsx";
import type { Mark } from "./pdf-pages.tsx";
import { SelectionActions } from "./selection.tsx";

const PdfPages = lazy(() => import("./pdf-pages.tsx"));

export type Material = MaterialsResponse["files"][number];

export function ReadView({
	store,
	state,
	files,
	file,
	onFile,
	layout,
	course,
}: {
	store: SessionStore;
	state: SessionState;
	files: Material[];
	/** The open file's path, or undefined when the course has none. */
	file?: string;
	onFile: (path: string) => void;
	layout: Layout;
	course: string;
}) {
	if (!file) return <NoMaterials course={course} />;
	return (
		<Read
			// A new file starts with a fresh page, scroll and drafts.
			key={file}
			store={store}
			state={state}
			files={files}
			file={file}
			onFile={onFile}
			layout={layout}
		/>
	);
}

function NoMaterials({ course }: { course: string }) {
	return (
		<div className="grid h-full place-content-center justify-items-center gap-2 px-6 text-center">
			<FileText aria-hidden className="size-6 text-subtle" />
			<p className="font-heading text-xl">No hay apuntes para leer</p>
			<p className="max-w-[46ch] text-sm text-muted-foreground">
				Copiá los PDFs del curso a <code>{course}/materials/</code>, en la
				carpeta de estudio, y aparecen acá.
			</p>
		</div>
	);
}

// ── Read ─────────────────────────────────────────────────────────────────────

function Read({
	store,
	state,
	files,
	file,
	onFile,
	layout,
}: {
	store: SessionStore;
	state: SessionState;
	files: Material[];
	file: string;
	onFile: (path: string) => void;
	layout: Layout;
}) {
	const scroller = useRef<HTMLDivElement>(null);
	const [chat, setChat] = useState(false);
	const [target, setTarget] = useState<{ turnId: string; n: number }>();
	const [active, setActive] = useState<string>();
	const [pending, setPending] = useState<Anchor>();
	const [draft, setDraft] = useState<Draft>();
	const [pages, setPages] = useState(0);
	const [failed, setFailed] = useState(false);
	const phone = layout === "phone";
	const [page, setPage] = useState(1);

	const items = useMemo(
		() => marginItems(state.view, file),
		[state.view, file],
	);
	const groups = useMemo(() => groupsOf(items), [items]);
	const marks = useMemo<Mark[]>(
		() =>
			groups.map((g) => ({
				key: g.key,
				anchor: g.anchor,
				kind: g.items.some((i) => i.kind === "turn") ? "question" : "note",
			})),
		[groups],
	);

	const openTurn = useCallback((turnId: string) => {
		setChat(true);
		setTarget((t) => ({ turnId, n: (t?.n ?? 0) + 1 }));
	}, []);
	const clearPending = useCallback(() => setPending(undefined), []);
	// A closed chat forgets which turn it was sent to, so reopening it
	// doesn't jump back there.
	const closeChat = useCallback(() => {
		setChat(false);
		setTarget(undefined);
	}, []);
	const toggleChat = useCallback(
		(open: boolean) => (open ? setChat(true) : closeChat()),
		[closeChat],
	);

	const note = async (anchor: Anchor, text?: string) => {
		setFailed(false);
		if (!(await store.note(anchor, text))) setFailed(true);
	};
	const onAsk = (anchor: Anchor, range: Range) => {
		if (chat || phone) {
			setPending(anchor);
			setChat(true);
		} else setDraft({ kind: "ask", anchor, range });
	};
	const onNote = (anchor: Anchor, range: Range) =>
		setDraft({ kind: "note", anchor, range });
	const onDraftDone = (text: string | null) => {
		if (draft && text !== null) {
			if (draft.kind === "ask") void store.send(text, draft.anchor);
			else void note(draft.anchor, text || undefined);
		}
		setDraft(undefined);
	};
	const onPassage = (key: string) => {
		if (phone) {
			// The strip's first card for the passage.
			document.getElementById(stripId(key))?.scrollIntoView({
				inline: "center",
				behavior: "smooth",
				block: "nearest",
			});
			return;
		}
		if (chat) {
			const first = groups
				.find((g) => g.key === key)
				?.items.find((i) => i.kind === "turn");
			if (first) openTurn(first.key);
		} else setActive(key);
	};

	const turnCount =
		(state.view?.turns.length ?? 0) + (state.view?.inflight ? 1 : 0);
	const panel = (closeIcon: "panel" | "x" = "panel") => (
		<ChatPanel
			store={store}
			state={state}
			pending={pending}
			onPendingClear={clearPending}
			target={target}
			onClose={closeChat}
			closeIcon={closeIcon}
		/>
	);

	const pdf = (
		<Suspense fallback={null}>
			<PdfPages
				path={file}
				marks={marks}
				active={active}
				selected={draft?.range ?? (pending && anchorRange(pending))}
				onPassage={onPassage}
				onHover={phone ? undefined : setActive}
				onPages={setPages}
				onPage={setPage}
				compact={phone}
			/>
		</Suspense>
	);
	const fileMenu = (
		<FileMenu
			files={files}
			file={file}
			onFile={onFile}
			label={`${basename(file)} · p. ${page}${pages ? ` de ${pages}` : ""}`}
		/>
	);
	const status = failed && (
		<div
			role="alert"
			className="turn-in absolute top-14 left-1/2 z-30 -translate-x-1/2 rounded-full border bg-card px-3 py-1 text-xs text-destructive shadow-sm"
		>
			No se pudo guardar la nota.
		</div>
	);

	if (phone) {
		return (
			<PhoneRead
				scroller={scroller}
				pdf={pdf}
				fileMenu={fileMenu}
				page={page}
				groups={groups}
				chat={chat}
				setChat={toggleChat}
				panel={panel}
				turnCount={turnCount}
				openTurn={openTurn}
				draft={draft}
				onDraftDone={onDraftDone}
				selection={
					<SelectionActions
						root={scroller}
						path={file}
						onAsk={onAsk}
						onNote={onNote}
					/>
				}
				status={status}
			/>
		);
	}

	const desktop = layout === "desktop";
	// On a desktop the chat covers the margin; a tablet has no room to cover
	// the page, so there it pushes the page aside.
	const push = chat && !desktop;
	const overlay = chat && desktop;

	return (
		<div
			className="relative grid h-full min-h-0"
			style={{
				gridTemplateColumns: push ? "minmax(0,1fr) 360px" : "minmax(0,1fr)",
			}}
		>
			<div
				ref={scroller}
				data-pdf-scroller
				className="min-h-0 overflow-y-auto overscroll-contain"
			>
				<div
					className={cn(
						"mx-auto flex max-w-full items-start justify-center",
						desktop ? "gap-4 px-8 pt-14" : "gap-3 px-4 pt-14",
					)}
				>
					{/* The bars' column stays while the chat is closed, so opening it doesn't move the page. */}
					<Gutter
						groups={chat ? groups : []}
						onOpenTurn={openTurn}
						onActive={setActive}
					/>
					<div className="min-w-0 flex-[0_1_760px] pb-24">{pdf}</div>
					{!chat && (
						<div
							className={cn("shrink-0", desktop ? "w-[340px]" : "w-[248px]")}
						>
							<Margin
								groups={groups}
								active={active}
								onActive={setActive}
								onOpenTurn={openTurn}
								draft={draft}
								onDraftDone={onDraftDone}
							/>
						</div>
					)}
					{overlay && (
						// Keeps the margin's room, so the page doesn't move under the overlay.
						<div aria-hidden className="w-[340px] shrink-0" />
					)}
				</div>
			</div>
			{push && <div className="min-h-0 border-l">{panel()}</div>}
			{overlay && (
				<div className="panel-in absolute inset-y-0 right-0 z-20 w-[min(440px,100%)] border-l shadow-lg">
					{panel("x")}
				</div>
			)}
			<SelectionActions
				root={scroller}
				path={file}
				onAsk={onAsk}
				onNote={onNote}
			/>
			<div className="absolute top-3 left-4 z-10">{fileMenu}</div>
			{!chat && (
				<ChatButton
					open={chat}
					onClick={() => setChat(true)}
					count={turnCount}
					className="absolute top-3 right-4 z-10 shadow-sm"
				/>
			)}
			{status}
		</div>
	);
}

const stripId = (key: string) => `strip-${encodeURIComponent(key)}`;

// ── The file menu ────────────────────────────────────────────────────────────

/** The open file and page; it lists the course's other PDFs to switch to. */
function FileMenu({
	files,
	file,
	onFile,
	label,
}: {
	files: Material[];
	file: string;
	onFile: (path: string) => void;
	label: string;
}) {
	const [open, setOpen] = useState(false);
	const pill =
		"inline-flex h-7 max-w-[min(420px,70vw)] items-center gap-1.5 rounded-full border bg-card/90 px-2.5 text-[12px] text-muted-foreground shadow-sm backdrop-blur";
	if (files.length < 2) {
		return (
			<span className={pill}>
				<FileText aria-hidden className="size-3.5 shrink-0" />
				<span className="truncate tabular-nums">{label}</span>
			</span>
		);
	}
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				aria-label={`Apunte: ${label}. Cambiar de apunte`}
				className={cn(
					pill,
					"transition-[color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.97]",
				)}
			>
				<FileText aria-hidden className="size-3.5 shrink-0" />
				<span className="truncate tabular-nums">{label}</span>
				<ChevronDown aria-hidden className="size-3.5 shrink-0" />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 gap-0 p-1">
				{files.map((f) => (
					<button
						key={f.path}
						type="button"
						aria-current={f.path === file || undefined}
						onClick={() => {
							setOpen(false);
							onFile(f.path);
						}}
						className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13.5px] hover:bg-secondary aria-[current]:font-medium aria-[current]:text-primary"
					>
						<FileText aria-hidden className="size-3.5 shrink-0 text-subtle" />
						<span className="min-w-0 truncate">{f.name}</span>
						<span className="ml-auto max-w-[40%] truncate text-[11.5px] text-subtle">
							{f.path.split("/").slice(2, -1).join("/")}
						</span>
					</button>
				))}
			</PopoverContent>
		</Popover>
	);
}

// ── Chat panel ───────────────────────────────────────────────────────────────

/** The thread beside the page, with the passage a question will quote above the composer. */
function ChatPanel({
	store,
	state,
	pending,
	onPendingClear,
	target,
	onClose,
	closeIcon = "panel",
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

function ChatButton({
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

// ── Read on a phone ──────────────────────────────────────────────────────────

function PhoneRead({
	scroller,
	pdf,
	fileMenu,
	page,
	groups,
	chat,
	setChat,
	panel,
	turnCount,
	openTurn,
	draft,
	onDraftDone,
	selection,
	status,
}: {
	scroller: RefObject<HTMLDivElement | null>;
	pdf: ReactNode;
	fileMenu: ReactNode;
	page: number;
	groups: Group[];
	chat: boolean;
	setChat: (open: boolean) => void;
	panel: (closeIcon?: "panel" | "x") => ReactNode;
	turnCount: number;
	openTurn: (turnId: string) => void;
	draft?: Draft;
	onDraftDone: (text: string | null) => void;
	selection: ReactNode;
	status: ReactNode;
}) {
	const onPage = groups.filter((g) => g.anchor.page === page);

	return (
		<div className="h-full min-h-0">
			<div className="relative h-full min-h-0">
				<div
					ref={scroller}
					data-pdf-scroller
					className="h-full overflow-y-auto overscroll-contain px-2 pt-2 pb-40"
				>
					<div className="sticky top-0 z-10 mb-2 flex justify-center">
						{fileMenu}
					</div>
					{pdf}
				</div>
				{selection}
				{status}
				<Strip
					groups={onPage}
					page={page}
					openTurn={openTurn}
					onChat={() => setChat(true)}
					turnCount={turnCount}
				/>
			</div>

			<Sheet open={chat} onOpenChange={setChat}>
				<SheetContent
					side="bottom"
					showCloseButton={false}
					className="data-[side=bottom]:h-[92dvh] gap-0 overflow-hidden rounded-t-2xl duration-300 ease-(--ease-drawer)"
				>
					<SheetTitle className="sr-only">Chat</SheetTitle>
					<SheetDescription className="sr-only">
						El hilo de la sesión
					</SheetDescription>
					<div className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-input" />
					<div className="min-h-0 flex-1">{panel("x")}</div>
				</SheetContent>
			</Sheet>

			<Sheet open={!!draft} onOpenChange={(o) => !o && onDraftDone(null)}>
				<SheetContent
					side="bottom"
					showCloseButton={false}
					className="gap-0 rounded-t-2xl p-3 pb-[max(12px,env(safe-area-inset-bottom))] duration-300 ease-(--ease-drawer)"
				>
					<SheetTitle className="sr-only">Nueva nota</SheetTitle>
					<SheetDescription className="sr-only">
						Una nota sobre el pasaje seleccionado
					</SheetDescription>
					{draft && <PhoneNote draft={draft} onDone={onDraftDone} />}
				</SheetContent>
			</Sheet>
		</div>
	);
}

function PhoneNote({
	draft,
	onDone,
}: {
	draft: Draft;
	onDone: (text: string | null) => void;
}) {
	const [text, setText] = useState("");
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				onDone(text.trim());
			}}
			className="grid gap-2"
		>
			<p className="line-clamp-3 border-l-2 border-highlight pl-2 font-heading text-[14px] text-muted-foreground italic">
				{draft.anchor.text}
			</p>
			<textarea
				value={text}
				onChange={(e) => setText(e.target.value)}
				rows={3}
				aria-label="Nota"
				placeholder="Escribí la nota (opcional)…"
				className="w-full resize-none rounded-lg bg-secondary px-3 py-2 font-heading text-[16px] outline-none"
			/>
			<button
				type="submit"
				className="h-11 rounded-lg bg-primary text-[15px] font-medium text-primary-foreground active:scale-[0.99]"
			>
				Guardar nota
			</button>
		</form>
	);
}

/** The phone's margin: the visible page's cards in a strip along the bottom. */
function Strip({
	groups,
	page,
	openTurn,
	onChat,
	turnCount,
}: {
	groups: Group[];
	page: number;
	openTurn: (turnId: string) => void;
	onChat: () => void;
	turnCount: number;
}) {
	const [noteOpen, setNoteOpen] = useState<{ text?: string; quote: string }>();
	const count = groups.reduce((n, g) => n + g.items.length, 0);
	return (
		<div className="absolute inset-x-0 bottom-0 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
			<div className="flex items-center justify-between px-3 pt-2 text-[12px] text-subtle">
				<span>
					p. {page} ·{" "}
					{count === 0 ? "sin preguntas ni notas" : `${count} en esta página`}
				</span>
				<button
					type="button"
					onClick={onChat}
					className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 font-medium text-primary active:scale-[0.97]"
				>
					<MessagesSquare aria-hidden className="size-3.5" />
					Chat · {turnCount}
				</button>
			</div>
			<div className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-3 pt-1.5 pb-3 [scrollbar-width:none]">
				{count === 0 && (
					<p className="py-3 text-[13px] text-muted-foreground">
						Seleccioná texto para preguntar o anotar.
					</p>
				)}
				{groups.flatMap((g) =>
					g.items.map((item, i) => (
						<button
							key={item.key}
							id={i === 0 ? stripId(g.key) : undefined}
							type="button"
							onClick={() =>
								item.kind === "turn"
									? openTurn(item.key)
									: setNoteOpen({
											quote: item.anchor.text,
											...(item.note.text ? { text: item.note.text } : {}),
										})
							}
							className={cn(
								"h-[76px] w-[78%] max-w-[300px] shrink-0 snap-center rounded-xl border bg-card px-3 py-2 text-left shadow-sm active:scale-[0.99]",
								item.kind === "note" && "border-l-[3px] border-l-highlight",
							)}
						>
							<span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">
								{item.kind === "turn" ? (
									<>
										<span className="grid size-[18px] place-items-center rounded-full bg-primary text-[10.5px] text-primary-foreground">
											{item.n}
										</span>
										{item.streaming ? (
											<span className="text-primary">Respondiendo</span>
										) : (
											"Pregunta"
										)}
									</>
								) : (
									"Nota"
								)}
							</span>
							<span className="mt-1 line-clamp-2 text-[13.5px] leading-snug">
								{item.kind === "turn"
									? snippet(item.turn.user.text)
									: (item.note.text ?? snippet(item.anchor.text))}
							</span>
						</button>
					)),
				)}
			</div>
			<Sheet
				open={!!noteOpen}
				onOpenChange={(o) => !o && setNoteOpen(undefined)}
			>
				<SheetContent
					side="bottom"
					className="gap-2 rounded-t-2xl p-4 pb-[max(16px,env(safe-area-inset-bottom))] duration-300 ease-(--ease-drawer)"
				>
					<SheetTitle className="text-[13px] font-semibold tracking-[0.06em] text-subtle uppercase">
						Nota
					</SheetTitle>
					<SheetDescription className="line-clamp-4 border-l-2 border-highlight pl-2 font-heading text-[14px] italic">
						{noteOpen?.quote}
					</SheetDescription>
					<p className="font-heading text-[16px]">
						{noteOpen?.text ?? (
							<span className="text-subtle">Resaltado sin texto</span>
						)}
					</p>
				</SheetContent>
			</Sheet>
		</div>
	);
}
