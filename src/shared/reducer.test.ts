import { expect, test } from "bun:test";
import type { SessionEvent, SessionMeta } from "./protocol.ts";
import { apply, emptyView, reduce } from "./reducer.ts";

const meta: SessionMeta = {
	id: "s1",
	course: "probabilidad",
	title: "",
	created: "2026-11-22T00:00:00.000Z",
};

const user = (turnId: string, queued = false): SessionEvent => ({
	type: "user_message",
	turnId,
	clientMsgId: `c-${turnId}`,
	from: "local",
	text: `pregunta ${turnId}`,
	attachments: [],
	queued,
});

const usage = { inputTokens: 10, outputTokens: 5 };

test("a turn moves from the queue to inflight to turns", () => {
	const events: SessionEvent[] = [
		user("t1"),
		user("t2", true),
		{ type: "turn_start", turnId: "t1" },
		{ type: "block_start", id: "b1", kind: "text" },
		{ type: "delta", id: "b1", text: "$x" },
		{ type: "delta", id: "b1", text: "^2$" },
	];
	const running = reduce(emptyView(meta), events);
	expect(running.status).toBe("running");
	expect(running.queue.map((m) => m.turnId)).toEqual(["t2"]);
	expect(running.inflight?.blocks).toEqual([
		{ id: "b1", kind: "text", text: "$x^2$", done: false },
	]);

	const done = reduce(running, [
		{ type: "turn_end", turnId: "t1", reason: "completed", usage },
	]);
	expect(done.status).toBe("idle");
	expect(done.inflight).toBeUndefined();
	expect(done.turns).toEqual([
		{
			id: "t1",
			user: {
				turnId: "t1",
				clientMsgId: "c-t1",
				from: "local",
				text: "pregunta t1",
				attachments: [],
			},
			// A turn that ends closes its open blocks.
			blocks: [{ id: "b1", kind: "text", text: "$x^2$", done: true }],
			end: { reason: "completed", usage },
		},
	]);
});

test("tool blocks keep their name and result", () => {
	const view = reduce(emptyView(meta), [
		user("t1"),
		{ type: "turn_start", turnId: "t1" },
		{ type: "block_start", id: "b1", kind: "tool", name: "Read" },
		{ type: "delta", id: "b1", text: '{"file_path":' },
		{ type: "block_end", id: "b1" },
		{ type: "tool_result", id: "b1", ok: true, summary: "# Notas" },
	]);
	expect(view.inflight?.blocks[0]).toEqual({
		id: "b1",
		kind: "tool",
		name: "Read",
		text: '{"file_path":',
		done: true,
		result: { ok: true, summary: "# Notas" },
	});
});

test("an error stays until the next turn starts", () => {
	const failed = reduce(emptyView(meta), [
		user("t1"),
		user("t2", true),
		{ type: "turn_start", turnId: "t1" },
		{ type: "error", code: "agent_failed", message: "no" },
		{ type: "turn_end", turnId: "t1", reason: "error", usage },
	]);
	expect(failed.error).toEqual({ code: "agent_failed", message: "no" });
	const next = apply(failed, { type: "turn_start", turnId: "t2" });
	expect(next.error).toBeUndefined();
});

test("notes are kept in order", () => {
	const anchor = { path: "materials/a.pdf", page: 3, text: "Teorema" };
	const view = reduce(emptyView(meta), [
		{ type: "note", id: "n1", anchor },
		{ type: "note", id: "n2", anchor, text: "ver" },
	]);
	expect(view.notes.map((n) => n.id)).toEqual(["n1", "n2"]);
});

test("unchanged parts keep their identity", () => {
	const before = reduce(emptyView(meta), [
		user("t1"),
		{ type: "turn_start", turnId: "t1" },
		{ type: "block_start", id: "b1", kind: "text" },
	]);
	const after = apply(before, { type: "delta", id: "b1", text: "a" });
	expect(after).not.toBe(before);
	expect(after.turns).toBe(before.turns);
	expect(after.queue).toBe(before.queue);
	expect(after.meta).toBe(before.meta);
});

test("events for another turn or block change nothing", () => {
	const view = reduce(emptyView(meta), [user("t1")]);
	expect(apply(view, { type: "delta", id: "nope", text: "a" })).toBe(view);
	expect(
		apply(view, { type: "turn_end", turnId: "t9", reason: "completed", usage }),
	).toBe(view);
});

test("a meta event replaces the session's title and mode", () => {
	const view = emptyView(meta);
	const next = apply(view, {
		type: "meta",
		meta: { ...meta, title: "Bernoulli", mode: "review" },
	});
	expect(next.meta).toEqual({ ...meta, title: "Bernoulli", mode: "review" });
	expect(next.turns).toBe(view.turns);
});
