/**
 * The app until the study folder arrives (step 3): one session at a time,
 * addressed by its URL (`/s/<id>`), so every client that opens the same URL
 * sees the same thread. `/` opens the latest session or starts one.
 */
import { SquarePen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { APP_NAME } from "../shared/app.ts";
import type {
	CreateSessionResponse,
	StateResponse,
} from "../shared/protocol.ts";
import { SessionStore, useSession } from "./store.ts";
import type { ThreadActions } from "./thread/parts.tsx";
import { Thread } from "./thread/Thread.tsx";

/** Sessions get a course from step 3's folder; until then they share this one. */
const COURSE = "general";

const sessionFromPath = () =>
	/^\/s\/([\w-]+)$/.exec(location.pathname)?.[1] ?? null;

export function ChatApp() {
	const [id, setId] = useState(sessionFromPath);

	useEffect(() => {
		if (id) return;
		let cancelled = false;
		void (async () => {
			const state = (await (await fetch("/api/state")).json()) as StateResponse;
			const latest = state.sessions.at(-1)?.id ?? (await createSession());
			if (!cancelled) open(latest, setId, "replace");
		})();
		return () => {
			cancelled = true;
		};
	}, [id]);

	useEffect(() => {
		const onPop = () => setId(sessionFromPath());
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);

	return (
		<div className="grid h-dvh grid-rows-[48px_1fr]">
			<header className="flex min-w-0 items-center gap-2 border-b bg-card px-3">
				<span className="font-heading text-[17px] font-semibold">
					{APP_NAME}
				</span>
				<span className="flex-1" />
				<button
					type="button"
					onClick={async () => open(await createSession(), setId, "push")}
					className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[13px] text-muted-foreground transition-[transform,color,border-color] duration-150 ease-out active:scale-[0.97] hover:border-input hover:text-foreground"
				>
					<SquarePen aria-hidden className="size-3.5" />
					<span className="max-sm:sr-only">Nueva sesión</span>
				</button>
			</header>
			<main className="min-h-0">
				{id ? (
					<Session
						key={id}
						id={id}
						onMissing={() => open(null, setId, "replace")}
					/>
				) : null}
			</main>
		</div>
	);
}

function Session({ id, onMissing }: { id: string; onMissing: () => void }) {
	// Made in an effect, not during render, so StrictMode's second mount gets
	// its own open socket.
	const [store, setStore] = useState<SessionStore>();
	useEffect(() => {
		const created = new SessionStore(id);
		setStore(created);
		return () => created.close();
	}, [id]);
	return store ? <Live store={store} onMissing={onMissing} /> : null;
}

function Live({
	store,
	onMissing,
}: {
	store: SessionStore;
	onMissing: () => void;
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

	// Sessions live in memory until step 3, so a restart forgets them.
	useEffect(() => {
		if (state.connection === "missing") onMissing();
	}, [state.connection, onMissing]);

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

async function createSession(): Promise<string> {
	const res = await fetch("/api/sessions", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ course: COURSE }),
	});
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
