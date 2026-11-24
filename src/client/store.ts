/**
 * The client's copy of one session: the server's snapshot plus every event
 * after it, folded with the shared reducer. Read it in React with
 * `useSession`. Commands go over HTTP; the WebSocket only pushes.
 *
 * - Events with `seq <= snapshot.seq` are already in the snapshot and dropped.
 * - A gap in `seq`, or a new `epoch` (the server restarted), re-subscribes,
 *   which brings a fresh snapshot.
 * - A dropped socket reconnects with backoff and re-subscribes, unless this
 *   browser was unpaired: the server closes a revoked device's sockets with
 *   1008 and refuses its upgrades with 403, which a socket only sees as a
 *   close before opening, so that case asks `/api/state`.
 */
import { useSyncExternalStore } from "react";
import {
	type Anchor,
	type NoteBody,
	type SendMessageBody,
	ServerMessage,
	type SessionView,
} from "../shared/protocol.ts";
import { apply } from "../shared/reducer.ts";
import { isUnpaired } from "./unpaired.ts";

/** A message this client sent that the server hasn't broadcast back yet. */
export type Outgoing = {
	clientMsgId: string;
	text: string;
	anchor?: Anchor;
	/** Set when the POST failed. */
	failed?: string;
};

export type SessionState = {
	/**
	 * `connecting` until the first snapshot; `offline` while reconnecting;
	 * `unpaired` once the server refuses this browser (it stops retrying).
	 */
	connection: "connecting" | "live" | "offline" | "missing" | "unpaired";
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

	/**
	 * Sends a message, quoting `anchor` when given; it shows as outgoing until
	 * the server broadcasts it.
	 */
	async send(text: string, anchor?: Anchor) {
		const clientMsgId = crypto.randomUUID();
		const message = { clientMsgId, text, ...(anchor ? { anchor } : {}) };
		this.set({ outgoing: [...this.state.outgoing, message] });
		const body: SendMessageBody = message;
		try {
			const res = await fetch(`/api/sessions/${this.id}/messages`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			if (await isUnpaired(res)) this.unpaired();
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

	/**
	 * Adds a note on a passage (no Claude turn). It shows once the server
	 * broadcasts it; resolves false when the server refused it.
	 */
	async note(anchor: Anchor, text?: string): Promise<boolean> {
		const body: NoteBody = { anchor, ...(text ? { text } : {}) };
		try {
			const res = await fetch(`/api/sessions/${this.id}/notes`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			if (await isUnpaired(res)) this.unpaired();
			return res.ok;
		} catch {
			return false;
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
		let opened = false;
		socket.onopen = () => {
			opened = true;
			this.retry = 0;
			this.resubscribe();
		};
		socket.onmessage = (event) => this.receive(String(event.data));
		socket.onclose = (event) => {
			if (this.socket !== socket || this.closed) return;
			if (event.code === REVOKED) return this.unpaired();
			if (!opened) void this.checkPaired();
			this.set({ connection: this.state.view ? "offline" : "connecting" });
			// 0.25 s, 0.5 s, 1 s … up to 5 s.
			const delay = Math.min(5000, 250 * 2 ** this.retry++);
			this.retryTimer = setTimeout(() => this.connect(), delay);
		};
	}

	/** Asks whether a refused upgrade was a 403 (unpaired) or the server being down. */
	private async checkPaired() {
		const res = await fetch("/api/state").catch(() => null);
		if (res && (await isUnpaired(res))) this.unpaired();
	}

	private unpaired() {
		this.close();
		this.set({ connection: "unpaired" });
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

/** The close code the server sends a revoked device's sockets (policy violation). */
const REVOKED = 1008;

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
