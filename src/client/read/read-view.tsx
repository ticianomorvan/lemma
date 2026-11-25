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
 *
 * This file holds the view's state; `read-wide.tsx` (tablet and desktop) and
 * `read-phone.tsx` lay it out.
 */
import "./read.css";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Anchor, MaterialsResponse } from "../../shared/protocol.ts";
import type { Layout } from "../layout.ts";
import type { SessionState, SessionStore } from "../store.ts";
import type { ComposerDraft } from "../thread/hooks.ts";
import { basename } from "../thread/model.ts";
import { anchorRange, type PagePlace } from "./anchors.ts";
import { ChatPanel } from "./chat-panel.tsx";
import { FileMenu } from "./file-menu.tsx";
import { groups as groupsOf, marginItems, marksOf } from "./items.ts";
import type { Draft } from "./margin.tsx";
import { PhoneRead, stripId } from "./read-phone.tsx";
import { WideRead } from "./read-wide.tsx";
import { SelectionActions } from "./selection.tsx";

const PdfPages = lazy(() => import("./pdf-pages.tsx"));

export type Material = MaterialsResponse["files"][number];

/**
 * What Read keeps when the session switches to Practice and back: the file,
 * where its pages were scrolled, and whether the chat was open.
 */
export type ReadMemory = { file: string; place?: PagePlace; chat: boolean };

export type ReadProps = {
	store: SessionStore;
	state: SessionState;
	files: Material[];
	/** The open file's path. */
	file: string;
	onFile: (path: string) => void;
	layout: Layout;
	/** Read's place, kept across switches: it opens there when the file matches. */
	memory: { current?: ReadMemory };
	/** The composer's text, shared with Practice. */
	draft: ComposerDraft;
};

export function ReadView(props: ReadProps) {
	// A new file starts with a fresh page, scroll and drafts.
	return <Read key={props.file} {...props} />;
}

function Read({
	store,
	state,
	files,
	file,
	onFile,
	layout,
	memory,
	draft: composerDraft,
}: ReadProps) {
	const scroller = useRef<HTMLDivElement>(null);
	const [kept] = useState(() =>
		memory.current?.file === file ? memory.current : undefined,
	);
	const [chat, setChat] = useState(kept?.chat ?? false);
	// The memory follows this file: its scroll as it moves, and the chat.
	const place = useRef(kept?.place);
	useEffect(() => {
		memory.current = { file, place: place.current, chat };
	}, [memory, file, chat]);
	const onPlace = useCallback(
		(now: PagePlace) => {
			place.current = now;
			memory.current = { file, place: now, chat };
		},
		[memory, file, chat],
	);
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
	const marks = useMemo(() => marksOf(groups), [groups]);

	const openTurn = useCallback((turnId: string) => {
		// The card or pin that was hovered goes away; so does its emphasis.
		setActive(undefined);
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
		(open: boolean) => {
			setActive(undefined);
			if (open) setChat(true);
			else closeChat();
		},
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
			draft={composerDraft}
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
				place={kept?.place}
				onPlace={onPlace}
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

	return (
		<WideRead
			desktop={layout === "desktop"}
			scroller={scroller}
			pdf={pdf}
			fileMenu={fileMenu}
			groups={groups}
			chat={chat}
			setChat={toggleChat}
			panel={panel}
			turnCount={turnCount}
			openTurn={openTurn}
			active={active}
			onActive={setActive}
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
