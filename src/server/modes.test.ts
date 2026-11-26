/**
 * Integration: study modes. The defaults are installed into the folder's
 * `.claude/skills/` without replacing anything there, and a session's `mode`
 * reaches the agent as its SKILL.md text with the next message.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StateResponse } from "../shared/protocol.ts";
import { DEFAULT_MODES, defaultSkill } from "./modes/modes.ts";
import { Client, cleanUp, hold, serve, turnEnds } from "./testing.ts";
import { parse } from "./transcript/transcript.ts";

afterEach(cleanUp);

const skill = (dir: string, mode: string) =>
	join(dir, ".claude", "skills", mode, "SKILL.md");

async function ask(
	api: (p: string, b?: unknown) => Promise<Response>,
	id: string,
	text: string,
) {
	const res = await api(`/api/sessions/${id}/messages`, {
		clientMsgId: crypto.randomUUID(),
		text,
	});
	expect(res.status).toBe(202);
}

test("the default modes are installed once and never overwrite the folder's files", async () => {
	const first = await serve({ streams: [] }, { create: false });
	const { dir } = first;
	for (const mode of DEFAULT_MODES) {
		expect(await readFile(skill(dir, mode), "utf8")).toBe(defaultSkill(mode));
	}
	const state = (await (await first.api("/api/state")).json()) as StateResponse;
	expect(state.modes.map(({ id, label }) => ({ id, label }))).toEqual([
		{ id: "read-along", label: "Leer juntos" },
		{ id: "explain", label: "Explicar" },
		{ id: "review", label: "Revisar" },
		{ id: "exam-prep", label: "Examen" },
	]);
	expect(state.modes[2]?.description).toContain("primer paso incorrecto");
	await first.server.stop(true);

	// The student edits one mode, adds their own, and the app starts again.
	const edited = "---\nname: review\nlabel: Corregir\n---\n\nSolo pistas.\n";
	await writeFile(skill(dir, "review"), edited);
	await mkdir(join(dir, ".claude", "skills", "flashcards"));
	await writeFile(skill(dir, "flashcards"), "Hacé tarjetas.\n");
	const second = await serve({ streams: [] }, { studyDir: dir, create: false });
	expect(await readFile(skill(dir, "review"), "utf8")).toBe(edited);
	const after = (await (
		await second.api("/api/state")
	).json()) as StateResponse;
	expect(after.modes.map((m) => m.label)).toEqual([
		"Leer juntos",
		"Explicar",
		"Corregir",
		"Examen",
		"flashcards",
	]);
});

test("a mode that is not in .claude/skills/ is refused", async () => {
	const { api, id, dir } = await serve({ streams: [] });
	const patch = (mode: unknown) =>
		api(`/api/sessions/${id}`, { mode }, "PATCH");
	expect((await patch("nope")).status).toBe(400);
	expect((await patch("../review")).status).toBe(400);
	expect((await patch("Review")).status).toBe(400);
	expect(
		(await api("/api/sessions", { course: "x", mode: "nope" })).status,
	).toBe(400);
	await rm(join(dir, ".claude", "skills", "explain"), { recursive: true });
	expect((await patch("explain")).status).toBe(400);
	expect((await patch("review")).status).toBe(200);
});

test("the mode reaches the agent with the next message, mid-session too", async () => {
	const gate = hold(3, 1);
	const { server, api, id, dir, driver } = await serve({
		streams: ["math"],
		pace: gate.pace,
	});
	const a = await Client.subscribe(server, id);
	const b = await Client.subscribe(server, id);
	await ask(api, id, "Sin modo");
	await turnEnds(1)(a);
	expect(driver.pushed[0]).not.toContain("<mode");

	// Chosen between turns: the next message carries the skill's text.
	expect(
		(await api(`/api/sessions/${id}`, { mode: "review" }, "PATCH")).status,
	).toBe(200);
	await b.untilEvent((e) => e.type === "meta" && e.meta.mode === "review");
	await ask(api, id, "Revisá esto");
	await gate.arrived;
	const sent = driver.pushed[1] ?? "";
	expect(sent).toStartWith('<mode name="review" label="Revisar">');
	expect(sent).toContain("el primer paso incorrecto");
	expect(sent).toEndWith("Revisá esto");

	// Changed while that turn runs: it applies to the turn after it.
	await api(`/api/sessions/${id}`, { mode: "explain" }, "PATCH");
	await ask(api, id, "¿Y esto?");
	gate.release();
	await turnEnds(3)(a);
	expect(driver.pushed[2]).toStartWith('<mode name="explain"');

	// Unchanged: no repeat. Cleared: Claude is told once.
	await ask(api, id, "Otra");
	await turnEnds(4)(a);
	expect(driver.pushed[3]).toBe("Otra");
	await api(`/api/sessions/${id}`, { mode: null }, "PATCH");
	await ask(api, id, "Normal");
	await turnEnds(5)(a);
	expect(driver.pushed[4]).toContain("turned the study mode off");
	expect(driver.pushed[4]).toEndWith("Normal");

	// Every client saw each change, and the file has it.
	const metas = b.events.flatMap((m) =>
		m.e.type === "meta" ? [m.e.meta.mode ?? null] : [],
	);
	expect(metas).toContain("explain");
	expect(metas.at(-1)).toBeNull();
	const files = await Array.fromAsync(
		new Bun.Glob("*/sessions/*.md").scan({ cwd: dir }),
	);
	const md = await readFile(join(dir, files[0] ?? ""), "utf8");
	expect(parse(md).meta.mode).toBeUndefined();
	// The transcript keeps the student's words, not the mode's text.
	expect(md).not.toContain("<mode");
});

test("an agent that starts over is told the session's mode again", async () => {
	const first = await serve({ streams: ["math"] });
	const { api, id } = first;
	await api(`/api/sessions/${id}`, { mode: "exam-prep" }, "PATCH");
	const a = await Client.subscribe(first.server, id);
	await ask(api, id, "Uno");
	await turnEnds(1)(a);
	expect(first.driver.pushed[0]).toStartWith('<mode name="exam-prep"');
	await first.server.stop(true);

	// After a restart the agent resumes, and gets the mode once more.
	const second = await serve(
		{ streams: [] },
		{ driver: first.driver, studyDir: first.dir, create: false },
	);
	const b = await Client.subscribe(second.server, id);
	await ask(second.api, id, "Dos");
	await turnEnds(1)(b);
	expect(first.driver.started.at(-1)?.resumed).toBe(true);
	expect(first.driver.pushed[1]).toStartWith('<mode name="exam-prep"');
});

test("a reseeded agent, which never saw the <mode> note, is told the mode", async () => {
	const { server, api, id, dir, driver } = await serve(
		{ streams: ["math"] },
		{ idleMs: 50 },
	);
	await api(`/api/sessions/${id}`, { mode: "review" }, "PATCH");
	const a = await Client.subscribe(server, id);
	await ask(api, id, "Uno");
	await turnEnds(1)(a);
	expect(driver.pushed[0]).toStartWith('<mode name="review"');

	// A hand edit between turns: the body no longer matches, so the next
	// agent starts fresh, seeded with the file.
	const files = await Array.fromAsync(
		new Bun.Glob("*/sessions/*.md").scan({ cwd: dir }),
	);
	const path = join(dir, files[0] ?? "");
	await writeFile(path, `${await readFile(path, "utf8")}\nUna línea mía.\n`);
	await ask(api, id, "Dos");
	await turnEnds(2)(a);
	expect(driver.started).toHaveLength(2);
	expect(driver.started[1]?.resumed).toBe(false);
	expect(driver.started[1]?.seed).toContain("Una línea mía.");
	expect(driver.pushed[1]).toStartWith('<mode name="review"');

	// The SDK's cache is gone and the idle agent was closed: reseeded again.
	driver.saved.clear();
	await Bun.sleep(120);
	await ask(api, id, "Tres");
	await turnEnds(3)(a);
	expect(driver.started).toHaveLength(3);
	expect(driver.started[2]?.resumed).toBe(false);
	expect(driver.pushed[2]).toStartWith('<mode name="review"');
});

test("an agent closed for idling resumes and is told the mode again", async () => {
	const { server, api, id, driver } = await serve(
		{ streams: ["math"] },
		{ idleMs: 50 },
	);
	await api(`/api/sessions/${id}`, { mode: "explain" }, "PATCH");
	const a = await Client.subscribe(server, id);
	await ask(api, id, "Uno");
	await turnEnds(1)(a);
	await Bun.sleep(120);
	await ask(api, id, "Dos");
	await turnEnds(2)(a);
	expect(driver.started).toHaveLength(2);
	expect(driver.started[1]?.resumed).toBe(true);
	expect(driver.pushed[1]).toStartWith('<mode name="explain"');
});
