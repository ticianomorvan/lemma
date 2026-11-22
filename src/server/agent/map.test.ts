import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { Folder } from "../folder/folder.ts";
import type { AgentEvent } from "./driver.ts";
import { FakeDriver, loadStream } from "./fake.ts";
import { SdkMapper } from "./map.ts";

function mapStream(name: string) {
	const mapper = new SdkMapper();
	return loadStream(name).flatMap((m) => mapper.map(m));
}

function text(events: AgentEvent[], kind = "text") {
	const ids = new Set(
		events.flatMap((e) =>
			e.type === "block_start" && e.kind === kind ? [e.id] : [],
		),
	);
	return events
		.map((e) => (e.type === "delta" && ids.has(e.id) ? e.text : ""))
		.join("");
}

test("a plain answer streams one text block and completes", () => {
	const events = mapStream("math");
	const result = loadStream("math").find((m) => m.type === "result");
	expect(events.map((e) => e.type)).toEqual([
		"block_start",
		...Array(events.length - 3).fill("delta"),
		"block_end",
		"turn_end",
	]);
	expect(result?.type === "result" && result.subtype === "success").toBe(true);
	if (result?.type === "result" && result.subtype === "success") {
		expect(text(events)).toBe(result.result);
	}
	const end = events.at(-1);
	expect(end).toMatchObject({ type: "turn_end", reason: "completed" });
	expect(end?.type === "turn_end" && end.usage.outputTokens).toBeGreaterThan(0);
});

test("a tool call gets its name, its input and its result", () => {
	const events = mapStream("tool");
	const tool = events.find((e) => e.type === "block_start");
	expect(tool).toMatchObject({ kind: "tool", name: "Read" });
	expect(JSON.parse(text(events, "tool")).file_path).toEndWith("/notas.md");
	expect(events.find((e) => e.type === "tool_result")).toEqual({
		type: "tool_result",
		id: tool?.type === "block_start" ? tool.id : "",
		ok: true,
		summary: "1\t# Notas",
	});
	expect(text(events)).toContain("Bernoulli");
	expect(events.at(-1)).toMatchObject({ reason: "completed" });
});

test("block ids stay unique across the API messages of one turn", () => {
	const ids = mapStream("tool").flatMap((e) =>
		e.type === "block_start" ? [e.id] : [],
	);
	expect(ids).toHaveLength(2);
	expect(new Set(ids).size).toBe(2);
});

test("an interrupted turn ends with reason interrupted and no error", () => {
	const events = mapStream("interrupt");
	expect(events.some((e) => e.type === "error")).toBe(false);
	expect(events.at(-1)).toMatchObject({
		type: "turn_end",
		reason: "interrupted",
	});
	// Thinking streams with empty text unless a thinking display is requested.
	expect(events).toContainEqual(expect.objectContaining({ kind: "thinking" }));
	expect(text(events)).not.toBe("");
});

test("an error result reports the error, then ends the turn", () => {
	const mapper = new SdkMapper();
	const result = loadStream("math").find((m) => m.type === "result");
	if (result?.type !== "result") throw new Error("no result");
	const failed = {
		...result,
		subtype: "error_max_turns",
		is_error: true,
		terminal_reason: "max_turns",
		errors: ["too many turns"],
	} as typeof result;
	expect(mapper.map(failed)).toEqual([
		{ type: "error", code: "max_turns", message: "too many turns" },
		{ type: "turn_end", reason: "error", usage: expect.any(Object) },
	]);
});

test("FakeDriver cuts the stream on interrupt and replays a real interrupted result", async () => {
	let release = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	const driver = new FakeDriver({
		streams: ["math"],
		pace: (index) => (index === 5 ? held : undefined),
	});
	const agent = driver.start({
		folder: new Folder(tmpdir()),
		sdkSessionId: "s",
		resume: false,
	});
	agent.push("hola");
	const events: AgentEvent[] = [];
	for await (const e of agent.events) {
		events.push(e);
		if (events.length === 3) {
			await agent.interrupt();
			release();
		}
		if (e.type === "turn_end") break;
	}
	expect(events.map((e) => e.type)).toEqual([
		"block_start",
		"delta",
		"delta",
		"block_end",
		"turn_end",
	]);
	expect(events.at(-1)).toMatchObject({ reason: "interrupted" });
	expect(driver.pushed).toEqual(["hola"]);
});
