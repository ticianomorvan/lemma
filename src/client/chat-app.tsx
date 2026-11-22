/**
 * The app shell: one session at a time, addressed by its URL (`/s/<id>`), so
 * every client that opens the same URL sees the same thread.
 * - Until the study folder is chosen, the first-run screen.
 * - `/` reopens the session used last, or starts one when there is none.
 */
import { SquarePen } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_NAME } from "../shared/app.ts";
import type {
	CreateSessionResponse,
	SessionMeta,
	StateResponse,
} from "../shared/protocol.ts";
import { FolderSetup } from "./folder-setup.tsx";
import { SessionsMenu } from "./sessions-menu.tsx";
import { SessionStore, useSession } from "./store.ts";
import type { ThreadActions } from "./thread/model.ts";
import { Thread } from "./thread/thread.tsx";

/** The course a new session goes in when the folder has none yet. */
const FIRST_COURSE = "general";

const sessionFromPath = () =>
	/^\/s\/([\w-]+)$/.exec(location.pathname)?.[1] ?? null;

export function ChatApp() {
	const [id, setId] = useState(sessionFromPath);
	const [meta, setMeta] = useState<SessionMeta>();
	const [screen, setScreen] = useState<"app" | "setup" | "failed">("app");
	const [attempt, setAttempt] = useState(0);
	const forget = useCallback(() => open(null, setId, "replace"), []);
	const retry = useCallback(() => {
		setScreen("app");
		setAttempt((n) => n + 1);
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs it on retry
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
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
			} catch {
				if (!cancelled) setScreen("failed");
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
			(created) => open(created, setId, "push"),
			() => {},
		);

	if (screen === "setup") return <FolderSetup onDone={retry} />;

	return (
		<div className="grid h-dvh grid-rows-[48px_1fr]">
			<header className="flex min-w-0 items-center gap-1 border-b bg-card px-3">
				<span className="mr-1 font-heading text-[17px] font-semibold">
					{APP_NAME}
				</span>
				<SessionsMenu
					current={id}
					label={
						meta && meta.id === id
							? `${meta.course} · ${meta.title || "Sin título"}`
							: "Sesiones"
					}
					loadState={loadState}
					onOpen={(next) => open(next, setId, "push")}
					onCreate={start}
				/>
				<span className="flex-1" />
				<button
					type="button"
					onClick={() => start(meta?.course ?? FIRST_COURSE)}
					className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[13px] text-muted-foreground transition-[transform,color,border-color] duration-150 ease-out active:scale-[0.97] hover:border-input hover:text-foreground"
				>
					<SquarePen aria-hidden className="size-3.5" />
					<span className="max-sm:sr-only">Nueva sesión</span>
				</button>
			</header>
			<main className="min-h-0">
				{id ? (
					<Session key={id} id={id} onMissing={forget} onMeta={setMeta} />
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
	);
}

function Session({
	id,
	onMissing,
	onMeta,
}: {
	id: string;
	onMissing: () => void;
	onMeta: (meta: SessionMeta) => void;
}) {
	// Made in an effect, not during render, so StrictMode's second mount gets
	// its own open socket.
	const [store, setStore] = useState<SessionStore>();
	useEffect(() => {
		const created = new SessionStore(id);
		setStore(created);
		return () => created.close();
	}, [id]);
	return store ? (
		<Live store={store} onMissing={onMissing} onMeta={onMeta} />
	) : null;
}

function Live({
	store,
	onMissing,
	onMeta,
}: {
	store: SessionStore;
	onMissing: () => void;
	onMeta: (meta: SessionMeta) => void;
}) {
	const state = useSession(store);
	const actions = useMemo<ThreadActions>(
		() => ({
			send: (text) => void store.send(text),
			stop: () => void store.interrupt(),
			discard: (clientMsgId) => store.discard(clientMsgId),
		}),
		[store],
	);

	// A session whose file is gone (deleted or moved): fall back to `/`.
	useEffect(() => {
		if (state.connection === "missing") onMissing();
	}, [state.connection, onMissing]);

	const meta = state.view?.meta;
	useEffect(() => {
		if (meta) onMeta(meta);
	}, [meta, onMeta]);

	return (
		<div className="relative h-full">
			<Thread state={state} actions={actions} />
			{state.connection === "offline" && (
				<div
					role="status"
					className="turn-in absolute top-3 left-1/2 -translate-x-1/2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm"
				>
					Sin conexión con el servidor · reconectando…
				</div>
			)}
		</div>
	);
}

async function loadState(): Promise<StateResponse> {
	const res = await fetch("/api/state");
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return (await res.json()) as StateResponse;
}

async function createSession(course: string): Promise<string> {
	const res = await fetch("/api/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ course }),
	});
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
