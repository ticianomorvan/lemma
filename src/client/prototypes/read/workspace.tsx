/**
 * One session seen through its two views: Read (the page, with margin cards
 * or the chat panel and pins) and Practice (the notebook, with citations
 * that open the page in a drawer). Switching is instant and keeps the thread.
 */
import {
	BookOpen,
	FileText,
	MessagesSquare,
	NotebookPen,
	PanelRightClose,
	X,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "#components/ui/sheet.tsx";
import { Tabs, TabsList, TabsTrigger } from "#components/ui/tabs.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#components/ui/tooltip.tsx";
import { cn } from "#lib/utils.ts";
import { APP_NAME } from "../../../shared/app.ts";
import type { Anchor } from "../../../shared/protocol.ts";
import { cellId, snippet, type ThreadActions } from "../../thread/model.ts";
import { Citation, Thread } from "../../thread/thread.tsx";
import { PDF_NAME } from "./fixture.ts";
import {
	type Group,
	groups as groupsOf,
	marginItems,
	revealAnchor,
} from "./items.ts";
import { type Draft, Gutter, InlinePins, Margin } from "./margin.tsx";
import {
	keepRange,
	type Mark,
	Pages,
	pageLabel,
	SelectionActions,
	useVisiblePage,
} from "./page.tsx";
import { type FakeSession, useFakeSession } from "./session.ts";
import type { Variant } from "./variants.ts";

type View = "read" | "practice";
type Size = "phone" | "tablet" | "desktop";

function useMedia(query: string) {
	return useSyncExternalStore(
		(cb) => {
			const m = matchMedia(query);
			m.addEventListener("change", cb);
			return () => m.removeEventListener("change", cb);
		},
		() => matchMedia(query).matches,
	);
}

function useSize(): Size {
	const tablet = useMedia("(min-width: 640px)");
	const desktop = useMedia("(min-width: 1024px)");
	return desktop ? "desktop" : tablet ? "tablet" : "phone";
}

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

export function Workspace({ variant }: { variant: Variant }) {
	const session = useFakeSession();
	const size = useSize();
	const [view, setView] = useState<View>("read");

	// ⌥1 / ⌥2 (Alt+1 / Alt+2): by key position, so ⌥ doesn't type "¡" first.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!e.altKey || e.metaKey || e.ctrlKey) return;
			if (e.code === "Digit1") setView("read");
			else if (e.code === "Digit2") setView("practice");
			else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const switcher = (
		<ViewSwitch
			view={view}
			onView={setView}
			style={variant.switcher}
			size={size}
		/>
	);

	return (
		<TooltipProvider delay={300}>
			<div className="grid h-dvh grid-rows-[48px_minmax(0,1fr)] bg-background">
				<header className="relative flex min-w-0 items-center gap-2 border-b bg-card px-3">
					<span className="font-heading text-[17px] font-semibold">
						{APP_NAME}
					</span>
					<span className="min-w-0 truncate text-[13px] text-muted-foreground max-sm:hidden">
						logica · Deducción natural
					</span>
					{variant.switcher === "start" && switcher}
					<span className="flex-1" />
					{variant.switcher === "center" && (
						<div className="absolute left-1/2 -translate-x-1/2">{switcher}</div>
					)}
					{variant.switcher === "compact" && switcher}
					<span id="header-end" className="contents" />
				</header>
				<main className="relative min-h-0">
					{view === "read" ? (
						<Read session={session} variant={variant} size={size} />
					) : (
						<Practice session={session} size={size} />
					)}
				</main>
			</div>
		</TooltipProvider>
	);
}

// ── The view switch ──────────────────────────────────────────────────────────

function ViewSwitch({
	view,
	onView,
	style,
	size,
}: {
	view: View;
	onView: (v: View) => void;
	style: Variant["switcher"];
	size: Size;
}) {
	const mod = isMac() ? "⌥" : "Alt+";
	const iconOnly = style === "compact" || size === "phone";
	const tab = (
		value: View,
		label: string,
		Icon: typeof BookOpen,
		key: string,
	) => {
		const trigger = (
			<TabsTrigger
				value={value}
				aria-label={iconOnly ? label : undefined}
				// Instant: the control changes state, it doesn't travel.
				className={cn(
					"h-7 gap-1.5 px-2.5 text-[13px] transition-none",
					iconOnly && "w-9 px-0",
				)}
			>
				{(style !== "center" || iconOnly) && (
					<Icon aria-hidden className="size-4" />
				)}
				{!iconOnly && label}
			</TabsTrigger>
		);
		return size === "phone" ? (
			<span key={value}>{trigger}</span>
		) : (
			<Tooltip key={value}>
				<TooltipTrigger render={<span />}>{trigger}</TooltipTrigger>
				<TooltipContent>
					{label}
					<kbd className="rounded bg-background/15 px-1 font-sans">
						{mod}
						{key}
					</kbd>
				</TooltipContent>
			</Tooltip>
		);
	};
	return (
		<Tabs value={view} onValueChange={(v) => onView(v as View)}>
			<TabsList aria-label="Vista" className="h-8">
				{tab("read", "Leer", BookOpen, "1")}
				{tab("practice", "Practicar", NotebookPen, "2")}
			</TabsList>
		</Tabs>
	);
}

// ── Chat panel ───────────────────────────────────────────────────────────────

/** The thread beside the page, with the passage a question will quote above the composer. */
function ChatPanel({
	session,
	pending,
	onPendingClear,
	target,
	onClose,
	closeIcon = "panel",
}: {
	session: FakeSession;
	pending?: Anchor;
	onPendingClear: () => void;
	/** A turn to bring into view: set by a pin or a card. `n` changes on each request. */
	target?: { turnId: string; n: number };
	onClose: () => void;
	/** `none` where something else closes it (the phone's tab bar). */
	closeIcon?: "panel" | "x" | "none";
}) {
	const actions = useMemo<ThreadActions>(
		() => ({
			...session.actions,
			send: (text) => {
				session.ask(text, pending);
				onPendingClear();
			},
		}),
		[session, pending, onPendingClear],
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

	const view = session.state.view;
	const count = (view?.turns.length ?? 0) + (view?.inflight ? 1 : 0);
	return (
		<section
			aria-label="Chat"
			className="grid h-full min-h-0 grid-rows-[40px_minmax(0,1fr)] bg-paper"
		>
			<div className="flex items-center gap-2 border-b bg-card px-3 text-[13px]">
				<MessagesSquare aria-hidden className="size-4 text-subtle" />
				<span className="font-medium">Chat</span>
				<span className="text-subtle">{count} preguntas</span>
				<span className="flex-1" />
				{closeIcon !== "none" && (
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
				)}
			</div>
			<Thread
				state={session.state}
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

// ── Read ─────────────────────────────────────────────────────────────────────

function useMarks(
	groups: Group[],
	active: string | undefined,
	after?: (g: Group) => ReactNode,
) {
	return useMemo(() => {
		const marks = new Map<string, Mark>();
		for (const g of groups) {
			const questions = g.items.filter((i) => i.kind === "turn").length;
			marks.set(g.key, {
				questions,
				notes: g.items.length - questions,
				active: active === g.key,
				...(after ? { after: after(g) } : {}),
			});
		}
		return marks;
	}, [groups, active, after]);
}

function Read({
	session,
	variant,
	size,
}: {
	session: FakeSession;
	variant: Variant;
	size: Size;
}) {
	const scroller = useRef<HTMLDivElement>(null);
	const [chat, setChat] = useState(false);
	const [target, setTarget] = useState<{ turnId: string; n: number }>();
	const [active, setActive] = useState<string>();
	const [pending, setPending] = useState<Anchor>();
	const [draft, setDraft] = useState<Draft>();
	const [sheetGroup, setSheetGroup] = useState<string>();
	const page = useVisiblePage(scroller);

	const items = marginItems(session.state, session.notes);
	const groups = useMemo(() => groupsOf(items), [items]);
	const openTurn = useCallback((turnId: string) => {
		setChat(true);
		setTarget((t) => ({ turnId, n: (t?.n ?? 0) + 1 }));
	}, []);
	const clearPending = useCallback(() => setPending(undefined), []);

	const inline = variant.pins === "inline" && (chat || size === "phone");
	const after = useCallback(
		(g: Group) => <InlinePins group={g} onOpenTurn={openTurn} />,
		[openTurn],
	);
	const marks = useMarks(groups, active, inline ? after : undefined);

	const phone = size === "phone";
	const onAsk = (anchor: Anchor, range: Range) => {
		if (chat || phone) {
			keepRange(anchor, range);
			setPending(anchor);
			setChat(true);
		} else setDraft({ kind: "ask", anchor, range });
	};
	const onNote = (anchor: Anchor, range: Range) =>
		setDraft({ kind: "note", anchor, range });
	const onDraftDone = (text: string | null) => {
		if (draft && text !== null) {
			keepRange(draft.anchor, draft.range);
			if (draft.kind === "ask") session.ask(text, draft.anchor);
			else session.note(draft.anchor, text || undefined);
		}
		setDraft(undefined);
	};
	const onPassage = (key: string) => {
		if (phone) {
			if (variant.phone === "sheet") setSheetGroup(key);
			else if (variant.phone === "strip")
				document.getElementById(`strip-${key}`)?.scrollIntoView({
					inline: "center",
					behavior: "smooth",
					block: "nearest",
				});
			else {
				const first = groups
					.find((g) => g.key === key)
					?.items.find((i) => i.kind === "turn");
				if (first) openTurn(first.key);
			}
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
		(session.state.view?.turns.length ?? 0) +
		(session.state.view?.inflight ? 1 : 0);
	const panel = (closeIcon: "panel" | "x" | "none" = "panel") => (
		<ChatPanel
			session={session}
			pending={pending}
			onPendingClear={clearPending}
			target={target}
			onClose={() => setChat(false)}
			closeIcon={closeIcon}
		/>
	);

	const pages = (
		<Pages
			marks={marks}
			onPassage={onPassage}
			onHover={phone ? undefined : setActive}
			compact={phone}
		/>
	);

	if (phone) {
		return (
			<PhoneRead
				variant={variant}
				scroller={scroller}
				pages={pages}
				page={page}
				groups={groups}
				chat={chat}
				setChat={setChat}
				panel={panel}
				turnCount={turnCount}
				sheetGroup={sheetGroup}
				setSheetGroup={setSheetGroup}
				openTurn={openTurn}
				draft={draft}
				onDraftDone={onDraftDone}
				selection={
					<SelectionActions root={scroller} onAsk={onAsk} onNote={onNote} />
				}
			/>
		);
	}

	const desktop = size === "desktop";
	// A tablet has no room to cover the page: the chat always pushes it there.
	const push = chat && (!desktop || variant.panel === "push");
	const swap = chat && desktop && variant.panel === "swap";
	const overlay = chat && !push && !swap;
	const marginWidth = !desktop
		? "w-[248px]"
		: variant.panel === "swap"
			? "w-[400px]"
			: "w-[340px]";
	// The bars sit left of the page; their column stays while the chat is
	// closed, so opening it doesn't move the page.
	const gutterStart = variant.pins === "bars";
	const gutterEnd = chat && variant.pins === "dots";

	return (
		<div
			className="relative grid h-full min-h-0"
			style={{
				gridTemplateColumns: push
					? `minmax(0,1fr) ${desktop ? 440 : 360}px`
					: "minmax(0,1fr)",
			}}
		>
			<div
				ref={scroller}
				className="min-h-0 overflow-y-auto overscroll-contain"
			>
				<div className="mx-auto flex max-w-full items-start justify-center gap-3 px-4 pt-6 lg:gap-4 lg:px-8 lg:pt-8">
					{gutterStart && (
						<Gutter
							groups={chat ? groups : []}
							style="bars"
							onOpenTurn={openTurn}
							onActive={setActive}
						/>
					)}
					<div className="min-w-0 flex-[0_1_680px] pb-24">{pages}</div>
					{gutterEnd && (
						<Gutter
							groups={groups}
							style="dots"
							onOpenTurn={openTurn}
							onActive={setActive}
						/>
					)}
					{!chat && (
						<div className={cn("shrink-0", marginWidth)}>
							<Margin
								groups={groups}
								style={variant.cards}
								active={active}
								onActive={setActive}
								onOpenTurn={openTurn}
								draft={draft}
								onDraftDone={onDraftDone}
							/>
						</div>
					)}
					{swap && (
						<div className="sticky top-0 -mt-8 h-[calc(100dvh-48px)] w-[400px] shrink-0 border-x">
							{panel()}
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
			<SelectionActions root={scroller} onAsk={onAsk} onNote={onNote} />
			<div className="pointer-events-none absolute top-3 left-4 z-10 hidden items-center gap-1.5 rounded-full border bg-card/90 px-2.5 py-1 text-[12px] text-muted-foreground shadow-sm backdrop-blur lg:flex">
				<FileText aria-hidden className="size-3.5" />
				<span className="tabular-nums">{pageLabel(page)}</span>
			</div>
			{!chat && (
				<ChatButton
					open={chat}
					onClick={() => setChat(true)}
					count={turnCount}
					className="absolute top-3 right-4 z-10 shadow-sm"
				/>
			)}
		</div>
	);
}

// ── Read on a phone ──────────────────────────────────────────────────────────

function PhoneRead({
	variant,
	scroller,
	pages,
	page,
	groups,
	chat,
	setChat,
	panel,
	turnCount,
	sheetGroup,
	setSheetGroup,
	openTurn,
	draft,
	onDraftDone,
	selection,
}: {
	variant: Variant;
	scroller: React.RefObject<HTMLDivElement | null>;
	pages: ReactNode;
	page: number;
	groups: Group[];
	chat: boolean;
	setChat: (open: boolean) => void;
	panel: (closeIcon?: "panel" | "x" | "none") => ReactNode;
	turnCount: number;
	sheetGroup?: string;
	setSheetGroup: (key: string | undefined) => void;
	openTurn: (turnId: string) => void;
	draft?: Draft;
	onDraftDone: (text: string | null) => void;
	selection: ReactNode;
}) {
	const onPage = groups.filter((g) => g.anchor.page === page);
	const tabs = variant.phone === "tabs";
	const sheetItems = groups.find((g) => g.key === sheetGroup);

	return (
		<div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto]">
			<div className="relative min-h-0">
				<div
					ref={scroller}
					className={cn(
						"h-full overflow-y-auto overscroll-contain px-2 pt-2",
						variant.phone === "strip" ? "pb-40" : "pb-24",
						tabs && chat && "hidden",
					)}
				>
					<div className="sticky top-0 z-10 mb-2 flex justify-center">
						<span className="rounded-full border bg-card/90 px-2.5 py-0.5 text-[11.5px] text-muted-foreground shadow-sm backdrop-blur tabular-nums">
							{PDF_NAME} · p. {page}
						</span>
					</div>
					{pages}
				</div>
				{tabs && chat && (
					<div className="absolute inset-0">{panel("none")}</div>
				)}
				{selection}

				{variant.phone === "sheet" && (
					<button
						type="button"
						onClick={() => setChat(true)}
						className="absolute right-4 bottom-[max(16px,env(safe-area-inset-bottom))] inline-flex h-11 items-center gap-2 rounded-full bg-foreground pr-4 pl-3.5 text-[14px] font-medium text-background shadow-lg transition-transform duration-150 ease-out active:scale-[0.97]"
					>
						<MessagesSquare aria-hidden className="size-4" />
						Chat
						<span className="rounded-full bg-background/15 px-1.5 text-[12px] tabular-nums">
							{turnCount}
						</span>
					</button>
				)}

				{variant.phone === "strip" && (
					<Strip
						groups={onPage}
						page={page}
						openTurn={openTurn}
						onChat={() => setChat(true)}
						turnCount={turnCount}
					/>
				)}
			</div>

			{tabs && (
				<nav
					aria-label="Leer"
					className="grid grid-cols-2 border-t bg-card pb-[env(safe-area-inset-bottom)]"
				>
					{(
						[
							[false, "Página", FileText],
							[true, "Chat", MessagesSquare],
						] as const
					).map(([isChat, label, Icon]) => (
						<button
							key={label}
							type="button"
							aria-pressed={chat === isChat}
							onClick={() => setChat(isChat)}
							className="flex h-12 items-center justify-center gap-1.5 text-[13px] text-subtle aria-pressed:font-medium aria-pressed:text-foreground"
						>
							<Icon aria-hidden className="size-4" />
							{label}
							{isChat && (
								<span className="rounded-full bg-secondary px-1.5 text-[11px] tabular-nums">
									{turnCount}
								</span>
							)}
						</button>
					))}
				</nav>
			)}

			{!tabs && (
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
			)}

			<Sheet
				open={!!sheetItems}
				onOpenChange={(o) => !o && setSheetGroup(undefined)}
			>
				<SheetContent
					side="bottom"
					showCloseButton={false}
					className="data-[side=bottom]:max-h-[70dvh] gap-0 rounded-t-2xl duration-300 ease-(--ease-drawer)"
				>
					<div className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-input" />
					<SheetTitle className="px-4 pt-1 text-[15px]">
						En este pasaje
					</SheetTitle>
					<SheetDescription className="sr-only">
						Preguntas y notas sobre el pasaje
					</SheetDescription>
					<div className="grid gap-2 overflow-y-auto p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
						{sheetItems?.items.map((item) =>
							item.kind === "turn" ? (
								<button
									key={item.key}
									type="button"
									onClick={() => {
										setSheetGroup(undefined);
										openTurn(item.key);
									}}
									className="grid gap-1 rounded-xl border bg-card px-3 py-2.5 text-left shadow-sm active:scale-[0.99]"
								>
									<span className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">
										<span className="grid size-[18px] place-items-center rounded-full bg-primary text-[10.5px] text-primary-foreground">
											{item.n}
										</span>
										Pregunta
									</span>
									<span className="text-[14px] font-medium">
										{snippet(item.turn.user.text)}
									</span>
								</button>
							) : (
								<div
									key={item.key}
									className="rounded-xl border border-l-[3px] border-l-highlight bg-card px-3 py-2.5 font-heading text-[14.5px]"
								>
									{item.note.text ?? "Resaltado sin texto"}
								</div>
							),
						)}
					</div>
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
	return (
		<div className="absolute inset-x-0 bottom-0 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
			<div className="flex items-center justify-between px-3 pt-2 text-[12px] text-subtle">
				<span>
					p. {page} ·{" "}
					{groups.length === 0
						? "sin preguntas ni notas"
						: `${groups.reduce((n, g) => n + g.items.length, 0)} en esta página`}
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
				{groups.length === 0 && (
					<p className="py-3 text-[13px] text-muted-foreground">
						Seleccioná texto para preguntar o anotar.
					</p>
				)}
				{groups.flatMap((g) =>
					g.items.map((item, i) => (
						<button
							key={item.key}
							id={i === 0 ? `strip-${g.key}` : undefined}
							type="button"
							onClick={() => item.kind === "turn" && openTurn(item.key)}
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
									: item.note.text}
							</span>
						</button>
					)),
				)}
			</div>
		</div>
	);
}

// ── Practice ─────────────────────────────────────────────────────────────────

function Practice({ session, size }: { session: FakeSession; size: Size }) {
	const [cited, setCited] = useState<Anchor>();
	useEffect(() => {
		if (!cited) return;
		const t = setTimeout(() => revealAnchor(cited), 320);
		return () => clearTimeout(t);
	}, [cited]);
	const marks = useMemo(() => {
		const m = new Map<string, Mark>();
		if (!cited) return m;
		const groups = groupsOf(marginItems(session.state, session.notes));
		for (const g of groups) {
			m.set(g.key, {
				questions: 1,
				notes: 0,
				active: g.anchor.text === cited.text && g.anchor.page === cited.page,
			});
		}
		return m;
	}, [cited, session.state, session.notes]);
	const phone = size === "phone";
	return (
		<>
			<Thread
				state={session.state}
				actions={session.actions}
				onCite={setCited}
			/>
			<Sheet open={!!cited} onOpenChange={(o) => !o && setCited(undefined)}>
				<SheetContent
					side={phone ? "bottom" : "right"}
					className={cn(
						"gap-0 bg-background duration-300 ease-(--ease-drawer)",
						phone
							? "data-[side=bottom]:h-[88dvh] rounded-t-2xl"
							: "data-[side=right]:w-[min(640px,92vw)] data-[side=right]:sm:max-w-none",
					)}
				>
					<div className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-4 pr-12">
						<FileText aria-hidden className="size-4 text-subtle" />
						<SheetTitle className="font-sans text-[13.5px]">
							{cited && pageLabel(cited.page)}
						</SheetTitle>
						<SheetDescription className="sr-only">
							La página que cita la pregunta
						</SheetDescription>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
						<Pages marks={marks} compact={phone} />
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}
