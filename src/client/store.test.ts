import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ServerMessage, SessionEvent } from "../shared/protocol.ts";
import { emptyView } from "../shared/reducer.ts";
import { SessionStore } from "./store.ts";

/** A WebSocket stand-in: records what the store sends, lets the test push. */
class StubSocket {
	static last: StubSocket;
	sent: unknown[] = [];
	onopen?: () => void;
	onmessage?: (e: { data: string }) => void;
	onclose?: (e: { code: number }) => void;
	constructor(readonly url: string) {
		StubSocket.last = this;
	}
	send(data: string) {
		this.sent.push(JSON.parse(data));
	}
	close() {}
	push(message: ServerMessage) {
		this.onmessage?.({ data: JSON.stringify(message) });
	}
}

const meta = { id: "s1", course: "general", title: "", created: "2026-11-22" };
const snapshot = (seq: number, epoch = 1): ServerMessage => ({
	t: "snapshot",
	session: "s1",
	epoch,
	seq,
	...emptyView(meta),
});
const ev = (seq: number, e: SessionEvent, epoch = 1): ServerMessage => ({
	t: "ev",
	session: "s1",
	epoch,
	seq,
	e,
});
const userMessage = (
	turnId: string,
	clientMsgId = `c-${turnId}`,
): SessionEvent => ({
	type: "user_message",
	turnId,
	clientMsgId,
	from: "local",
	text: turnId,
	attachments: [],
	queued: false,
});

const original = globalThis.WebSocket;
const originalFetch = globalThis.fetch;
let store: SessionStore;
let socket: StubSocket;

beforeEach(() => {
	globalThis.WebSocket = StubSocket as unknown as typeof WebSocket;
	store = new SessionStore("s1", "ws://test/ws");
	socket = StubSocket.last;
	socket.onopen?.();
});

afterEach(() => {
	store.close();
	globalThis.WebSocket = original;
	globalThis.fetch = originalFetch;
});

const subs = () => socket.sent.filter((m) => (m as { t: string }).t === "sub");
const queue = () => store.getSnapshot().view?.queue.map((m) => m.turnId);

test("subscribes on open and folds events after the snapshot", () => {
	expect(subs()).toEqual([{ t: "sub", session: "s1" }]);
	expect(store.getSnapshot().connection).toBe("connecting");
	socket.push(snapshot(3));
	expect(store.getSnapshot().connection).toBe("live");
	socket.push(ev(4, userMessage("a")));
	socket.push(ev(5, userMessage("b")));
	expect(queue()).toEqual(["a", "b"]);
});

test("drops events already in the snapshot", () => {
	socket.push(snapshot(5));
	socket.push(ev(5, userMessage("old")));
	socket.push(ev(6, userMessage("new")));
	expect(queue()).toEqual(["new"]);
});

test("a seq gap re-subscribes and ignores events until the new snapshot", () => {
	socket.push(snapshot(1));
	socket.push(ev(3, userMessage("skipped-ahead")));
	expect(subs()).toHaveLength(2);
	socket.push(ev(4, userMessage("still-waiting")));
	expect(queue()).toEqual([]);
	socket.push(snapshot(4));
	socket.push(ev(5, userMessage("after")));
	expect(queue()).toEqual(["after"]);
});

test("a new epoch (server restart) re-subscribes", () => {
	socket.push(snapshot(9, 1));
	socket.push(ev(10, userMessage("x"), 2));
	expect(subs()).toHaveLength(2);
	expect(queue()).toEqual([]);
});

test("a dropped socket shows offline and reconnects", async () => {
	socket.push(snapshot(1));
	socket.onclose?.({ code: 1006 });
	expect(store.getSnapshot().connection).toBe("offline");
	await Bun.sleep(300);
	expect(StubSocket.last).not.toBe(socket);
});

test("a socket the server closes for a revoked device stops retrying", async () => {
	socket.push(snapshot(1));
	socket.onclose?.({ code: 1008 });
	expect(store.getSnapshot().connection).toBe("unpaired");
	await Bun.sleep(300);
	expect(StubSocket.last).toBe(socket);
});

test("an upgrade refused before opening asks whether this browser is still paired", async () => {
	const asked: string[] = [];
	globalThis.fetch = (async (url: string) => {
		asked.push(url);
		return Response.json(
			{ error: { code: "unpaired", message: "" } },
			{ status: 403 },
		);
	}) as unknown as typeof fetch;
	socket.onclose?.({ code: 1006 });
	await Bun.sleep(300);
	// The reconnect attempt is refused: it closes without ever opening.
	const retry = StubSocket.last;
	expect(retry).not.toBe(socket);
	retry.onclose?.({ code: 1006 });
	await Bun.sleep(0);
	expect(asked).toEqual(["/api/state"]);
	expect(store.getSnapshot().connection).toBe("unpaired");
});

test("an upgrade refused while the server is down keeps retrying", async () => {
	globalThis.fetch = (async () => {
		throw new Error("connection refused");
	}) as unknown as typeof fetch;
	socket.onclose?.({ code: 1006 });
	await Bun.sleep(300);
	const retry = StubSocket.last;
	retry.onclose?.({ code: 1006 });
	await Bun.sleep(600);
	expect(store.getSnapshot().connection).toBe("connecting");
	expect(StubSocket.last).not.toBe(retry);
});

test("an unknown session is reported as missing", () => {
	socket.push({ t: "error", session: "s1", code: "not_found", message: "" });
	expect(store.getSnapshot().connection).toBe("missing");
});

test("a failed send that the server got anyway leaves no duplicate", async () => {
	globalThis.fetch = (async () => {
		throw new Error("network down");
	}) as unknown as typeof fetch;
	socket.push(snapshot(1));
	await store.send("hola");
	const [failed] = store.getSnapshot().outgoing;
	expect(failed?.failed).toBe("network down");
	socket.push(ev(2, userMessage("t1", failed?.clientMsgId)));
	expect(store.getSnapshot().outgoing).toEqual([]);
});
