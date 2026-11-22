/**
 * Integration: real HTTP and WebSocket against FakeDriver, which replays the
 * recorded SDK streams in test/fixtures/streams.
 */
import { afterEach, expect, test } from "bun:test";
import {
	type EventMessage,
	SendMessageResponse,
	ServerMessage,
	type SessionEvent,
	type SnapshotMessage,
} from "../shared/protocol.ts";
import { reduce } from "../shared/reducer.ts";
import { FakeDriver, type FakeDriverOptions } from "./agent/fake.ts";
import { startServer } from "./http.ts";

type Server = Awaited<ReturnType<typeof startServer>>;
const servers: Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
	for (const ws of sockets.splice(0)) ws.close();
	for (const server of servers.splice(0)) await server.stop(true);
});

async function serve(options: FakeDriverOptions) {
	const driver = new FakeDriver(options);
	const server = await startServer({ port: 0, distDir: null, driver });
	servers.push(server);
	const api = (path: string, body?: unknown) =>
		fetch(new URL(path, server.url), {
			method: body === undefined ? "GET" : "POST",
			headers: { "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	const res = await api("/api/sessions", { course: "probabilidad" });
	expect(res.status).toBe(201);
	const { id } = (await res.json()) as { id: string };
	return { server, api, id, driver };
}

/** Holds replay before message `index` of turn `turn` until `release()`. */
function hold(index: number, turn = 0) {
	let release = () => {};
	let reached = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	const arrived = new Promise<void>((resolve) => (reached = resolve));
	return {
		pace: (i: number, t: number) => {
			if (i !== index || t !== turn) return;
			reached();
			return held;
		},
		arrived,
		release: () => release(),
	};
}

class Client {
	readonly messages: ServerMessage[] = [];
	private waiters: (() => void)[] = [];

	private constructor(readonly ws: WebSocket) {
		ws.onmessage = (m) => {
			this.messages.push(ServerMessage.parse(JSON.parse(String(m.data))));
			for (const wake of this.waiters.splice(0)) wake();
		};
	}

	static async subscribe(server: Server, session: string) {
		const ws = new WebSocket(
			new URL("/ws", server.url.href.replace("http", "ws")),
		);
		sockets.push(ws);
		await new Promise((resolve) => (ws.onopen = resolve));
		const client = new Client(ws);
		ws.send(JSON.stringify({ t: "sub", session }));
		await client.until((m) => m.t === "snapshot");
		return client;
	}

	get snapshot() {
		return this.messages.find((m) => m.t === "snapshot") as SnapshotMessage;
	}

	get events() {
		return this.messages.filter((m): m is EventMessage => m.t === "ev");
	}

	/** Resolves once a message matches, including one already received. */
	async until(match: (m: ServerMessage) => boolean) {
		while (!this.messages.some(match)) {
			await new Promise<void>((wake) => this.waiters.push(wake));
		}
	}

	untilEvent(match: (e: SessionEvent) => boolean) {
		return this.until((m) => m.t === "ev" && match(m.e));
	}

	/** The view this client holds: its snapshot plus the events after it. */
	view() {
		const { t: _, session: __, epoch: ___, seq: ____, ...view } = this.snapshot;
		return reduce(
			view,
			this.events.map((m) => m.e),
		);
	}
}

const turnEnds = (n: number) => (c: Client) =>
	c.until(() => c.events.filter((m) => m.e.type === "turn_end").length >= n);

test("two clients receive identical events", async () => {
	const { server, api, id } = await serve({ streams: ["tool"] });
	const a = await Client.subscribe(server, id);
	const b = await Client.subscribe(server, id);

	const res = await api(`/api/sessions/${id}/messages`, {
		clientMsgId: "m1",
		text: "Leé notas.md",
	});
	expect(res.status).toBe(202);
	await Promise.all([a, b].map(turnEnds(1)));

	expect(a.events.length).toBeGreaterThan(10);
	expect(b.events).toEqual(a.events);
	expect(a.events.map((m) => m.seq)).toEqual(
		a.events.map((_, i) => a.snapshot.seq + i + 1),
	);
	const types = new Set(a.events.map((m) => m.e.type));
	expect([...types]).toEqual(
		expect.arrayContaining([
			"user_message",
			"turn_start",
			"tool_result",
			"turn_end",
		]),
	);
});

test("a client joining mid-stream gets the snapshot plus the rest, without duplicates", async () => {
	const gate = hold(8);
	const { server, api, id } = await serve({
		streams: ["math"],
		pace: gate.pace,
	});
	const early = await Client.subscribe(server, id);
	await api(`/api/sessions/${id}/messages`, {
		clientMsgId: "m1",
		text: "Var(X)?",
	});
	await gate.arrived;

	const late = await Client.subscribe(server, id);
	const partial = late.snapshot.inflight?.blocks[0]?.text ?? "";
	expect(late.snapshot.status).toBe("running");
	expect(partial).not.toBe("");
	gate.release();
	await Promise.all([early, late].map(turnEnds(1)));

	// The late client's events start right after its snapshot and have no gaps.
	const seqs = late.events.map((m) => m.seq);
	expect(seqs[0]).toBe(late.snapshot.seq + 1);
	expect(seqs).toEqual(seqs.map((_, i) => late.snapshot.seq + i + 1));
	// They are exactly the tail of what the early client saw.
	expect(late.events).toEqual(
		early.events.filter((m) => m.seq > late.snapshot.seq),
	);
	// Both rebuild the same view, and it matches what the server holds now.
	expect(late.view()).toEqual(early.view());
	const now = (await (
		await api(`/api/sessions/${id}`)
	).json()) as SnapshotMessage;
	const { t: _, session: __, epoch: ___, seq: ____, ...serverView } = now;
	expect(late.view()).toEqual(serverView);
	expect(serverView.turns[0]?.blocks[0]?.text.startsWith(partial)).toBe(true);
});

test("two concurrent POSTs are answered in arrival order", async () => {
	// Hold the first turn so the second message arrives while it runs.
	const gate = hold(1);
	const { server, api, id } = await serve({
		streams: ["math", "tool"],
		pace: gate.pace,
	});
	const client = await Client.subscribe(server, id);

	const [first, second] = await Promise.all(
		["m1", "m2"].map(async (clientMsgId) => {
			const res = await api(`/api/sessions/${id}/messages`, {
				clientMsgId,
				text: clientMsgId,
			});
			expect(res.status).toBe(202);
			return SendMessageResponse.parse(await res.json());
		}),
	);
	await gate.arrived;
	gate.release();
	await turnEnds(2)(client);

	// Arrival order is the order the server broadcast the messages in.
	const arrived = client.events.flatMap((m) =>
		m.e.type === "user_message" ? [m.e] : [],
	);
	expect(arrived.map((e) => e.queued)).toEqual([false, true]);
	const order = arrived.map((e) => e.turnId);
	expect(order.toSorted()).toEqual(
		[first?.turnId ?? "", second?.turnId ?? ""].toSorted(),
	);
	// Each response matches its broadcast copy.
	for (const res of [first, second]) {
		const copy = arrived.find((e) => e.turnId === res?.turnId);
		expect(copy?.queued).toBe(res?.queued);
	}

	// Turns run one at a time, in that order.
	const lifecycle = client.events.flatMap((m) =>
		m.e.type === "turn_start" || m.e.type === "turn_end"
			? [`${m.e.type}:${m.e.turnId}`]
			: [],
	);
	expect(lifecycle).toEqual([
		`turn_start:${order[0]}`,
		`turn_end:${order[0]}`,
		`turn_start:${order[1]}`,
		`turn_end:${order[1]}`,
	]);
	const turns = client.view().turns;
	expect(turns.map((t) => t.user.text)).toEqual(arrived.map((e) => e.text));
	// The first turn got the first recorded stream, the second the tool one.
	expect(turns[1]?.blocks.some((b) => b.kind === "tool")).toBe(true);
	expect(turns[0]?.blocks.some((b) => b.kind === "tool")).toBe(false);
});

test("an interrupt ends the turn with reason interrupted, and the queue goes on", async () => {
	const gate = hold(6);
	const { server, api, id } = await serve({
		streams: ["math"],
		pace: gate.pace,
	});
	const client = await Client.subscribe(server, id);
	await api(`/api/sessions/${id}/messages`, { clientMsgId: "m1", text: "uno" });
	await api(`/api/sessions/${id}/messages`, { clientMsgId: "m2", text: "dos" });
	await gate.arrived;

	const res = await api(`/api/sessions/${id}/interrupt`, {});
	expect(await res.json()).toEqual({ interrupted: true });
	gate.release();
	await turnEnds(2)(client);

	const ends = client.events.flatMap((m) =>
		m.e.type === "turn_end" ? [m.e] : [],
	);
	expect(ends.map((e) => e.reason)).toEqual(["interrupted", "completed"]);
	const [cut, full] = client.view().turns;
	expect(cut?.end?.reason).toBe("interrupted");
	expect(cut?.blocks.every((b) => b.done)).toBe(true);
	expect(full?.blocks[0]?.text.length).toBeGreaterThan(
		cut?.blocks[0]?.text.length ?? 0,
	);

	const idle = await api(`/api/sessions/${id}/interrupt`, {});
	expect(await idle.json()).toEqual({ interrupted: false });
});

test("a failed agent ends its turn with an error, and the next turn resumes", async () => {
	// "missing" has no fixture, so the fake agent fails the way a crashed one does.
	const { server, api, id, driver } = await serve({
		streams: ["missing", "math"],
	});
	const client = await Client.subscribe(server, id);
	await api(`/api/sessions/${id}/messages`, { clientMsgId: "m1", text: "uno" });
	await api(`/api/sessions/${id}/messages`, { clientMsgId: "m2", text: "dos" });
	await turnEnds(2)(client);

	const [failed, ok] = client.view().turns;
	expect(failed?.end?.reason).toBe("error");
	expect(ok?.end?.reason).toBe("completed");
	expect(client.events.map((m) => m.e)).toContainEqual(
		expect.objectContaining({ type: "error", code: "agent_failed" }),
	);
	expect(client.view().error).toBeUndefined();
	expect(driver.started).toEqual([
		{ sessionId: id },
		{ sessionId: id, resume: id },
	]);
});

test("bad input gets a 400, non-JSON a 415 and an unknown session a 404", async () => {
	const { server, api, id } = await serve({ streams: ["math"] });
	expect((await api(`/api/sessions/${id}/messages`, { text: "" })).status).toBe(
		400,
	);
	expect((await api("/api/sessions", { course: "" })).status).toBe(400);
	const missing = await api("/api/sessions/nope/messages", {
		clientMsgId: "m",
		text: "hola",
	});
	expect(missing.status).toBe(404);
	expect((await api("/api/sessions/nope")).status).toBe(404);
	expect((await api("/api/nothing")).status).toBe(404);
	const form = await fetch(new URL("/api/sessions", server.url), {
		method: "POST",
		headers: { "content-type": "text/plain" },
		body: JSON.stringify({ course: "x" }),
	});
	expect(form.status).toBe(415);

	const client = await Client.subscribe(server, id);
	client.ws.send(JSON.stringify({ t: "sub", session: "nope" }));
	await client.until((m) => m.t === "error");
	expect(client.messages.at(-1)).toMatchObject({
		t: "error",
		code: "not_found",
	});
});

test("state lists sessions and their courses", async () => {
	const { api, id } = await serve({ streams: ["math"] });
	await api("/api/sessions", { course: "logica", title: "Deducción natural" });
	const state = await (await api("/api/state")).json();
	expect(state.courses).toEqual(["logica", "probabilidad"]);
	expect(state.sessions.map((s: { id: string }) => s.id)).toContain(id);
});
