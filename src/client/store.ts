/**
 * The client's copy of one session: the server's snapshot plus every event
 * after it, folded with the shared reducer. Read it in React with
 * `useSession`. Commands go over HTTP; the WebSocket only pushes.
 *
 * - Events with `seq <= snapshot.seq` are already in the snapshot and dropped.
 * - A gap in `seq`, or a new `epoch` (the server restarted), re-subscribes,
 *   which brings a fresh snapshot.
 * - A dropped socket reconnects with backoff and re-subscribes.
 */
import { useSyncExternalStore } from "react";
import {
	type SendMessageBody,
	ServerMessage,
	type SessionView,
} from "../shared/protocol.ts";
import { apply } from "../shared/reducer.ts";

/** A message this client sent that the server hasn't broadcast back yet. */
export type Outgoing = {
	clientMsgId: string;
	text: string;
	/** Set when the POST failed. */
	failed?: string;
};

export type SessionState = {
	/** `connecting` until the first snapshot; `offline` while reconnecting. */
	connection: "connecting" | "live" | "offline" | "missing";
	view?: SessionView;
	outgoing: Outgoing[];
};

type Listener = () => void;

export class SessionStore {
	private state: SessionState = { connection: "connecting", outgoing: [] };
	private readonly listeners = new Set<Listener>();
	private socket?: WebSocket;
	private seq = 0;
	private epoch?: number;
	/** True between a (re-)`sub` and its snapshot; events are ignored meanwhile. */
	private awaiting = true;
	private retry = 0;
	private retryTimer?: ReturnType<typeof setTimeout>;
	private closed = false;

	constructor(
		readonly id: string,
		private readonly url = defaultSocketUrl(),
	) {
		this.connect();
	}

	subscribe = (listener: Listener) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	getSnapshot = () => this.state;

	/** Sends a message; it shows as outgoing until the server broadcasts it. */
	async send(text: string) {
		const clientMsgId = crypto.randomUUID();
		this.set({
			outgoing: [...this.state.outgoing, { clientMsgId, text }],
		});
		const body: SendMessageBody = { clientMsgId, text };
		try {
			const res = await fetch(`/api/sessions/${this.id}/messages`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) throw new Error(await errorMessage(res));
		} catch (error) {
			this.set({
				outgoing: this.state.outgoing.map((m) =>
					m.clientMsgId === clientMsgId
						? { ...m, failed: String((error as Error).message ?? error) }
						: m,
				),
			});
		}
	}

	/** Drops a failed outgoing message, returning its text for the composer. */
	discard(clientMsgId: string) {
		const message = this.state.outgoing.find(
			(m) => m.clientMsgId === clientMsgId,
		);
		this.set({
			outgoing: this.state.outgoing.filter(
				(m) => m.clientMsgId !== clientMsgId,
			),
		});
		return message?.text ?? "";
	}

	/** Stops the running answer. A failure is harmless: the answer just goes on. */
	async interrupt() {
		await fetch(`/api/sessions/${this.id}/interrupt`, { method: "POST" }).catch(
			() => {},
		);
	}

	close() {
		this.closed = true;
		clearTimeout(this.retryTimer);
		this.socket?.close();
	}

	private connect() {
		const socket = new WebSocket(this.url);
		this.socket = socket;
		socket.onopen = () => {
			this.retry = 0;
			this.resubscribe();
		};
		socket.onmessage = (event) => this.receive(String(event.data));
		socket.onclose = () => {
			if (this.socket !== socket || this.closed) return;
			this.set({ connection: this.state.view ? "offline" : "connecting" });
			// 0.25 s, 0.5 s, 1 s … up to 5 s.
			const delay = Math.min(5000, 250 * 2 ** this.retry++);
			this.retryTimer = setTimeout(() => this.connect(), delay);
		};
	}

	private resubscribe() {
		this.awaiting = true;
		this.socket?.send(JSON.stringify({ t: "sub", session: this.id }));
	}

	private receive(raw: string) {
		let parsed: ServerMessage;
		try {
			parsed = ServerMessage.parse(JSON.parse(raw));
		} catch {
			return;
		}
		const message = parsed;
		if ("session" in message && message.session !== this.id) return;
		switch (message.t) {
			case "snapshot": {
				const { t: _, session: __, epoch, seq, ...view } = message;
				this.epoch = epoch;
				this.seq = seq;
				this.awaiting = false;
				this.set({ connection: "live", view: view as SessionView });
				return;
			}
			case "ev": {
				if (this.awaiting || !this.state.view) return;
				if (message.epoch !== this.epoch) return this.resubscribe();
				if (message.seq <= this.seq) return;
				if (message.seq !== this.seq + 1) return this.resubscribe();
				this.seq = message.seq;
				this.set({ view: apply(this.state.view, message.e) });
				return;
			}
			case "error":
				if (message.code === "not_found") this.set({ connection: "missing" });
				return;
			case "folder":
				return;
		}
	}

	private set(patch: Partial<SessionState>) {
		const next = { ...this.state, ...patch };
		// Outgoing messages the server has broadcast are now in the view.
		if (next.view && next.outgoing.length > 0) {
			const seen = sentIds(next.view);
			// Even a "failed" one: the POST may have reached the server anyway.
			const outgoing = next.outgoing.filter((m) => !seen.has(m.clientMsgId));
			if (outgoing.length !== next.outgoing.length) next.outgoing = outgoing;
		}
		this.state = next;
		for (const listener of this.listeners) listener();
	}
}

function sentIds(view: SessionView) {
	const ids = new Set<string>();
	for (const turn of view.turns) ids.add(turn.user.clientMsgId);
	if (view.inflight) ids.add(view.inflight.user.clientMsgId);
	for (const m of view.queue) ids.add(m.clientMsgId);
	return ids;
}

function defaultSocketUrl() {
	const { protocol, host } = window.location;
	return `${protocol === "https:" ? "wss" : "ws"}://${host}/ws`;
}

async function errorMessage(res: Response) {
	try {
		const body = (await res.json()) as { error?: { message?: string } };
		return body.error?.message ?? `HTTP ${res.status}`;
	} catch {
		return `HTTP ${res.status}`;
	}
}

export function useSession(store: SessionStore): SessionState {
	return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
