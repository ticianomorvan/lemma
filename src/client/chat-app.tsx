/**
 * The app shell: one session at a time, addressed by its URL (`/s/<id>`), so
 * every client that opens the same URL sees the same thread.
 * - A browser that isn't paired gets the pairing screen (the server refuses
 *   it everything else), and so does a used or expired `/pair/<code>` link
 *   (the page redeems it with a POST; a paired browser always gets in).
 * - Until the study folder is chosen, the first-run screen.
 * - `/` reopens the session used last, or starts one when there is none.
 * - A session shows as Read (its course's PDF with the thread beside it) or
 *   Practice (the thread as a notebook); each client keeps its own choice.
 */
import { LoaderCircle, Printer, SquarePen } from "lucide-react";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#components/ui/tooltip.tsx";
import { cn } from "#lib/utils.ts";
import { APP_NAME } from "../shared/app.ts";
import type {
	Anchor,
	CreateSessionResponse,
	MaterialsResponse,
	SessionMeta,
	SessionView,
	StateResponse,
} from "../shared/protocol.ts";
import { DevicesMenu } from "./devices-menu.tsx";
import { FolderSetup } from "./folder-setup.tsx";
import { type Layout, useLayout } from "./layout.ts";
import { Title, titleText } from "./markdown/lazy.tsx";
import { isPairingPath, PairingScreen, redeemLink } from "./pairing.tsx";
import { PracticeView } from "./practice/practice-view.tsx";
import { usePrint } from "./print/use-print.tsx";
import type { PagePlace } from "./read/anchors.ts";
import type { Material, ReadMemory } from "./read/read-view.tsx";
import { SessionsMenu } from "./sessions-menu.tsx";
import { photoActions, SessionStore, useSession } from "./store.ts";
import type { ThreadPlace } from "./thread/hooks.ts";
import type { ThreadActions } from "./thread/model.ts";
import { isUnpaired } from "./unpaired.ts";
import { useViewKeys, type View, ViewSwitch } from "./view-switch.tsx";

/** Read and its PDF renderer load on first use; Practice is the first load. */
const ReadView = lazy(() =>
	import("./read/read-view.tsx").then((m) => ({ default: m.ReadView })),
);

/** The header's mode menu: Base UI's Menu stays out of the first load. */
const ModeMenu = lazy(() => import("./modes/mode-menu.tsx"));

/** The course a new session goes in when the folder has none yet. */
const FIRST_COURSE = "general";

const sessionFromPath = () =>
	/^\/s\/([\w-]+)$/.exec(location.pathname)?.[1] ?? null;

/** The server answered 403 `unpaired`: this browser has no valid device cookie. */
class Unpaired extends Error {}

export function ChatApp() {
	const [id, setId] = useState(sessionFromPath);
	const [meta, setMeta] = useState<SessionMeta>();
	const [screen, setScreen] = useState<
		"app" | "setup" | "failed" | "unpaired" | "pairing" | "expired" | "offline"
	>(isPairingPath() ? "pairing" : "app");
	const unpair = useCallback(() => {
		history.replaceState(null, "", "/");
		setScreen("unpaired");
	}, []);
	const [attempt, setAttempt] = useState(0);
	const forget = useCallback(() => open(null, setId, "replace"), []);
	const layout = useLayout();
	const [chosenView, setChosenView] = useState(storedView);
	const chooseView = useCallback((next: View) => {
		setChosenView(next);
		save("lemma:view", next);
	}, []);
	const files = useMaterials(meta && meta.id === id ? meta.course : undefined);
	// A course with no PDFs has nothing to read: it stays in Practice. Until
	// this client picks a view, a course with PDFs opens in Read.
	const readable = files === undefined || files.length > 0;
	const view: View | undefined = readable
		? (chosenView ?? (files && "read"))
		: "practice";
	/** Set by the open session: what it carries into Read when the view switches there. */
	const toRead = useRef<() => void>(undefined);
	/** Set by the open session: prints it. */
	const printer = useRef<() => Promise<void>>(undefined);
	const pickView = useCallback(
		(next: View) => {
			if (next === "read" && !readable) return;
			if (next === "read") toRead.current?.();
			chooseView(next);
		},
		[readable, chooseView],
	);
	useViewKeys(pickView);
	const retry = useCallback(() => {
		setScreen("app");
		setAttempt((n) => n + 1);
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs it on retry
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				if (isPairingPath()) {
					const next = await redeemLink().catch(() => "offline" as const);
					if (cancelled) return;
					if (next === "offline") return setScreen("offline");
					// A full load, so this page starts over with its new cookie.
					return next ? location.replace(next) : setScreen("expired");
				}
				const state = await loadState();
				if (cancelled) return;
				if (state.folder === null) return setScreen("setup");
				if (id) return;
				const latest = state.sessions.toSorted((a, b) =>
					b.updated.localeCompare(a.updated),
				)[0];
				const target =
					latest?.id ?? (await createSession(state.courses[0] ?? FIRST_COURSE));
				if (!cancelled) open(target, setId, "replace");
			} catch (error) {
				if (cancelled) return;
				setScreen(error instanceof Unpaired ? "unpaired" : "failed");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [id, attempt]);

	useEffect(() => {
		const onPop = () => setId(sessionFromPath());
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);

	const start = (course: string) =>
		createSession(course).then(
			(created) => {
				open(created, setId, "push");
				return true;
			},
			(error) => {
				if (error instanceof Unpaired) unpair();
				return false;
			},
		);

	if (screen === "setup") {
		return <FolderSetup onDone={retry} onUnpaired={unpair} />;
	}
	// Redeeming takes one request; nothing to show meanwhile.
	if (screen === "pairing") return null;
	if (screen === "expired") return <PairingScreen kind="expired" />;
	if (screen === "offline") {
		return <PairingScreen kind="offline" onRetry={() => location.reload()} />;
	}
	if (screen === "unpaired") {
		return <PairingScreen kind="unpaired" onRetry={retry} />;
	}

	return (
		<TooltipProvider delay={300}>
			<div className="grid h-dvh grid-rows-[48px_minmax(0,1fr)]">
				<header className="flex min-w-0 items-center gap-1 border-b bg-card px-3">
					<span className="mr-1 font-heading text-[17px] font-semibold">
						{APP_NAME}
					</span>
					<SessionsMenu
						current={id}
						label={
							meta && meta.id === id ? (
								<>
									{meta.course} · <Title title={meta.title} />
								</>
							) : (
								"Sesiones"
							)
						}
						hint={
							meta && meta.id === id
								? `${meta.course} · ${titleText(meta.title)}`
								: "Sesiones"
						}
						loadState={loadState}
						onOpen={(next) => open(next, setId, "push")}
						onCreate={start}
					/>
					{id && (
						<ViewSwitch
							view={view}
							onView={pickView}
							layout={layout}
							noPdfsIn={readable ? undefined : (meta?.course ?? "")}
						/>
					)}
					<span className="flex-1" />
					{id && (
						<Suspense fallback={null}>
							<ModeMenu
								meta={meta && meta.id === id ? meta : undefined}
								compact={layout === "phone"}
							/>
						</Suspense>
					)}
					{/* A phone's header has no room for it; ⌘P / Ctrl+P is for keyboards anyway. */}
					{id && layout !== "phone" && <PrintButton printer={printer} />}
					<DevicesMenu onUnpaired={unpair} />
					<button
						type="button"
						onClick={() => void start(meta?.course ?? FIRST_COURSE)}
						className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[13px] text-muted-foreground transition-[transform,color,border-color] duration-150 ease-out active:scale-[0.97] hover:border-input hover:text-foreground"
					>
						<SquarePen aria-hidden className="size-3.5" />
						<span className={cn(layout === "phone" && "sr-only")}>
							Nueva sesión
						</span>
					</button>
				</header>
				<main className="min-h-0">
					{id ? (
						<Session
							key={id}
							id={id}
							onMissing={forget}
							onUnpaired={unpair}
							onMeta={setMeta}
							view={view}
							onView={pickView}
							toRead={toRead}
							printer={printer}
							files={files}
							layout={layout}
						/>
					) : screen === "failed" ? (
						<div className="grid h-full place-content-center justify-items-center gap-3 text-center text-sm text-muted-foreground">
							<p>No se pudo conectar con el servidor de Lemma.</p>
							<button
								type="button"
								onClick={retry}
								className="h-8 rounded-lg border bg-card px-3 text-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
							>
								Reintentar
							</button>
						</div>
					) : null}
				</main>
			</div>
		</TooltipProvider>
	);
}

type SessionProps = {
	onMissing: () => void;
	onUnpaired: () => void;
	onMeta: (meta: SessionMeta) => void;
	/** Undefined until the course's materials are known. */
	view?: View;
	onView: (view: View) => void;
	toRead: { current?: () => void };
	printer: { current?: () => Promise<void> };
	/** Undefined until the server lists them. */
	files?: Material[];
	layout: Layout;
};

function Session({ id, ...props }: SessionProps & { id: string }) {
	// Made in an effect, not during render, so StrictMode's second mount gets
	// its own open socket.
	const [store, setStore] = useState<SessionStore>();
	useEffect(() => {
		const created = new SessionStore(id);
		setStore(created);
		return () => created.close();
	}, [id]);
	return store ? <Live store={store} {...props} /> : null;
}

function Live({
	store,
	onMissing,
	onUnpaired,
	onMeta,
	view,
	onView,
	toRead,
	printer,
	files,
	layout,
}: SessionProps & { store: SessionStore }) {
	const state = useSession(store);
	const meta = state.view?.meta;
	const printing = usePrint(state.view);
	useEffect(() => {
		printer.current = printing.print;
		return () => {
			printer.current = undefined;
		};
	}, [printer, printing.print]);
	const actions = useMemo<ThreadActions>(
		() => ({
			send: (text, attachmentIds) =>
				void store.send(text, undefined, attachmentIds),
			stop: () => void store.interrupt(),
			discard: (clientMsgId) => store.discard(clientMsgId),
			...photoActions(store),
		}),
		[store],
	);

	// A session whose file is gone (deleted or moved): fall back to `/`.
	useEffect(() => {
		if (state.connection === "missing") onMissing();
		// Revoked, here or from another device.
		if (state.connection === "unpaired") onUnpaired();
	}, [state.connection, onMissing, onUnpaired]);

	useEffect(() => {
		if (meta) onMeta(meta);
	}, [meta, onMeta]);

	const [chosenFile, setChosenFile] = useState(() =>
		load(`lemma:file:${store.id}`),
	);
	const chooseFile = useCallback(
		(path: string) => {
			setChosenFile(path);
			save(`lemma:file:${store.id}`, path);
		},
		[store.id],
	);

	// What survives switching views (the session's views share one thread;
	// each keeps its own scroll): the composer's text, Practice's scroll,
	// and Read's file, scroll and chat.
	const [text, setText] = useState("");
	const draft = useMemo(() => ({ text, setText }), [text]);
	const practicePlace = useRef<ThreadPlace>(undefined);
	const readMemory = useRef<ReadMemory>(undefined);

	// Practice's open citation. Switching to Read with it open opens Read on
	// that file, where the drawer was scrolled; the drawer doesn't come back.
	const [cited, setCited] = useState<Anchor>();
	const drawerPlace = useRef<PagePlace>(undefined);
	const cite = useCallback((anchor: Anchor | undefined) => {
		drawerPlace.current = anchor && { page: anchor.page, into: 0 };
		setCited(anchor);
	}, []);
	const has = (path?: string) =>
		!!path && !!files?.some((f) => f.path === path);
	const file = files && openFile(files, chosenFile, state.view);
	// Runs in the switch's own event, so Read mounts with it in one render.
	useEffect(() => {
		toRead.current = () => {
			if (!cited) return;
			if (has(cited.path)) {
				chooseFile(cited.path);
				readMemory.current = {
					file: cited.path,
					place: drawerPlace.current,
					chat: false,
				};
			}
			setCited(undefined);
		};
		return () => {
			toRead.current = undefined;
		};
	});

	return (
		<div className="relative h-full">
			{view === "read" && file && files ? (
				<Suspense fallback={null}>
					<ReadView
						store={store}
						state={state}
						files={files}
						file={file}
						onFile={chooseFile}
						layout={layout}
						memory={readMemory}
						draft={draft}
					/>
				</Suspense>
			) : view === "practice" ? (
				<PracticeView
					state={state}
					actions={actions}
					layout={layout}
					draft={draft}
					place={practicePlace}
					cited={cited}
					onCite={cite}
					onDrawerPlace={(place) => {
						drawerPlace.current = place;
					}}
					canRead={has}
					onRead={() => onView("read")}
				/>
			) : null}
			{state.connection === "offline" && (
				<div
					role="status"
					className="turn-in absolute top-3 left-1/2 -translate-x-1/2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm"
				>
					Sin conexión con el servidor · reconectando…
				</div>
			)}
			{printing.node}
		</div>
	);
}

/** "Imprimir": the browser's print dialog, with the session as a document (print/). */
function PrintButton({
	printer,
}: {
	printer: { current?: () => Promise<void> };
}) {
	const [busy, setBusy] = useState(false);
	const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
	const Icon = busy ? LoaderCircle : Printer;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						aria-label="Imprimir"
						aria-busy={busy || undefined}
						onClick={() => {
							if (!printer.current || busy) return;
							setBusy(true);
							void printer.current().finally(() => setBusy(false));
						}}
						className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-[transform,color,background-color] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.97]"
					/>
				}
			>
				<Icon aria-hidden className={cn("size-3.5", busy && "animate-spin")} />
			</TooltipTrigger>
			<TooltipContent>
				{busy ? "Preparando…" : "Imprimir"}
				<kbd className="rounded bg-background/15 px-1 font-sans">{mod}P</kbd>
			</TooltipContent>
		</Tooltip>
	);
}

/**
 * The file Read opens: the one this client chose for the session, else the
 * one the thread quoted last, else the course's first.
 */
function openFile(
	files: Material[],
	chosen: string | null,
	view: SessionView | undefined,
) {
	const has = (path?: string | null) =>
		path && files.some((f) => f.path === path) ? path : undefined;
	const quoted = [
		...(view?.turns ?? []).map((t) => t.user.anchor?.path),
		...(view?.notes ?? []).map((n) => n.anchor.path),
	].findLast((p) => has(p));
	return has(chosen) ?? has(quoted) ?? files[0]?.path;
}

/** The PDFs in a course's `materials/`, or undefined while asking. */
function useMaterials(course: string | undefined) {
	const [files, setFiles] = useState<{ course: string; files: Material[] }>();
	useEffect(() => {
		if (course === undefined) return;
		let cancelled = false;
		fetch(`/api/courses/${encodeURIComponent(course)}/materials`)
			.then((res) => (res.ok ? res.json() : { files: [] }))
			.catch(() => ({ files: [] }))
			.then((body: MaterialsResponse) => {
				if (!cancelled) setFiles({ course, files: body.files });
			});
		return () => {
			cancelled = true;
		};
	}, [course]);
	return files && files.course === course ? files.files : undefined;
}

/** Per-browser preferences; storage may be off (a private window). */
function load(key: string) {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function save(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Not kept; the choice still holds until reload.
	}
}

function storedView(): View | null {
	const v = load("lemma:view");
	return v === "read" || v === "practice" ? v : null;
}

async function loadState(): Promise<StateResponse> {
	const res = await fetch("/api/state");
	if (await isUnpaired(res)) throw new Unpaired();
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return (await res.json()) as StateResponse;
}

async function createSession(course: string): Promise<string> {
	const res = await fetch("/api/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ course }),
	});
	if (await isUnpaired(res)) throw new Unpaired();
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return ((await res.json()) as CreateSessionResponse).id;
}

function open(
	id: string | null,
	setId: (id: string | null) => void,
	mode: "push" | "replace",
) {
	const path = id ? `/s/${id}` : "/";
	if (mode === "push") history.pushState(null, "", path);
	else history.replaceState(null, "", path);
	setId(id);
}
