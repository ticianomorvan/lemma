/**
 * Integration: real HTTP and WebSocket against FakeDriver, which replays the
 * recorded SDK streams in test/fixtures/streams.
 */
import { afterEach, expect, test } from "bun:test";
import {
	SendMessageResponse,
	type SnapshotMessage,
} from "../shared/protocol.ts";
import { Client, cleanUp, hold, serve, turnEnds } from "./testing.ts";

afterEach(cleanUp);

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
	// The crashed agent may not have saved its session, so the next one
	// starts fresh, seeded with the transcript so far.
	const [first, second] = driver.started;
	expect(first).toMatchObject({ resumed: false });
	expect(first?.seed).toBeUndefined();
	expect(second).toMatchObject({ resumed: false });
	expect(second?.sdkSessionId).not.toBe(first?.sdkSessionId);
	expect(second?.seed).toContain("## Tú\n\nuno");
	expect(second?.seed).not.toContain("dos");
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
	const form = await api("/api/sessions", { course: "x" }, "POST", {
		"content-type": "text/plain",
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
