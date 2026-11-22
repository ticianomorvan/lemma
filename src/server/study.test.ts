/**
 * Integration: sessions as Markdown files in the study folder, and resuming
 * or reseeding the agent across restarts and edits. FakeDriver plays the SDK:
 * it saves a session once a turn reaches its `result`.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StateResponse } from "../shared/protocol.ts";
import { FakeDriver } from "./agent/fake.ts";
import {
	Client,
	cleanUp,
	hold,
	serve,
	start,
	studyDir,
	turnEnds,
} from "./testing.ts";
import { parse } from "./transcript/transcript.ts";

afterEach(cleanUp);

async function sessionFile(dir: string, api: (p: string) => Promise<Response>) {
	const state = (await (await api("/api/state")).json()) as StateResponse;
	const [session] = state.sessions;
	const files = await Array.fromAsync(
		new Bun.Glob("*/sessions/*.md").scan({ cwd: dir }),
	);
	expect(files).toHaveLength(1);
	const path = join(dir, files[0] ?? "");
	return { path, session, md: () => readFile(path, "utf8") };
}

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

test("a session is a Markdown file from its creation, and each turn is appended", async () => {
	const { server, api, id, dir } = await serve({ streams: ["math"] });
	const file = await sessionFile(dir, api);
	expect(file.path).toMatch(
		/probabilidad\/sessions\/\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.md$/,
	);
	expect(parse(await file.md())).toMatchObject({ meta: { id }, entries: [] });

	const client = await Client.subscribe(server, id);
	await ask(api, id, "¿Cuál es la varianza de una Bernoulli?");
	await turnEnds(1)(client);

	const { meta, entries } = parse(await file.md());
	expect(entries.map((e) => e.kind)).toEqual(["user", "answer"]);
	expect(entries[1]).toMatchObject({ reason: "completed" });
	expect((entries[1] as { text: string }).text).toContain("$");
	// The first message names the session, and clients hear about it.
	expect(meta.title).toBe("¿Cuál es la varianza de una Bernoulli?");
	expect(client.view().meta.title).toBe(meta.title);
	expect(meta.sdk_session_id).toBeString();
	expect(meta.sdk_body_hash).toBeString();
});

test("after a restart the session resumes: same SDK session, history intact", async () => {
	const first = await serve({ streams: ["math"] });
	const a = await Client.subscribe(first.server, first.id);
	await ask(first.api, first.id, "uno");
	await turnEnds(1)(a);
	const before = a.view();
	const sdkSessionId = first.driver.started[0]?.sdkSessionId;
	await first.server.stop(true);

	const second = await serve(
		{ streams: [] },
		{ driver: first.driver, studyDir: first.dir, create: false },
	);
	const b = await Client.subscribe(second.server, first.id);
	expect(b.snapshot.epoch).not.toBe(a.snapshot.epoch);
	expect(b.snapshot.turns.map((t) => t.user.text)).toEqual(["uno"]);
	expect(b.snapshot.turns[0]?.blocks[0]?.text).toBe(
		before.turns[0]?.blocks
			.filter((x) => x.kind === "text")
			.map((x) => x.text.trim())
			.join("\n\n"),
	);

	await ask(second.api, first.id, "dos");
	await turnEnds(1)(b);
	expect(first.driver.started).toHaveLength(2);
	expect(first.driver.started[1]).toMatchObject({
		sdkSessionId,
		resumed: true,
	});
	// The driver resumed, so the seed it was offered goes unused.
	const file = await sessionFile(first.dir, second.api);
	const { meta, entries } = parse(await file.md());
	expect(meta.sdk_session_id).toBe(sdkSessionId);
	expect(entries.map((e) => e.kind)).toEqual([
		"user",
		"answer",
		"user",
		"answer",
	]);
});

test("a hand-edited transcript makes the next send reseed instead of resume", async () => {
	const first = await serve({ streams: ["math"] });
	const a = await Client.subscribe(first.server, first.id);
	await ask(first.api, first.id, "uno");
	await turnEnds(1)(a);
	await first.server.stop(true);

	// Edited while the server is down, as in any editor.
	const [path] = await Array.fromAsync(
		new Bun.Glob("*/sessions/*.md").scan({ cwd: first.dir }),
	);
	const full = join(first.dir, path ?? "");
	await writeFile(
		full,
		(await readFile(full, "utf8")).replace(
			"## Tú\n\nuno\n",
			"## Tú\n\nuno (corregido a mano)\n",
		),
	);

	const second = await serve(
		{ streams: [] },
		{ driver: first.driver, studyDir: first.dir, create: false },
	);
	const b = await Client.subscribe(second.server, first.id);
	expect(b.snapshot.turns[0]?.user.text).toBe("uno (corregido a mano)");
	await ask(second.api, first.id, "dos");
	await turnEnds(1)(b);

	const [, started] = first.driver.started;
	expect(started?.resumed).toBe(false);
	expect(started?.sdkSessionId).not.toBe(first.driver.started[0]?.sdkSessionId);
	expect(started?.seed).toContain("uno (corregido a mano)");
	expect(started?.seed).not.toContain("dos");
	// The new SDK session is recorded, so the send after this one resumes it.
	const { meta } = parse(await readFile(full, "utf8"));
	expect(meta.sdk_session_id).toBe(started?.sdkSessionId);
});

test("an SDK session that is gone (cache cleaned, or never saved) is reseeded", async () => {
	const first = await serve({ streams: ["math"] });
	const a = await Client.subscribe(first.server, first.id);
	await ask(first.api, first.id, "uno");
	await turnEnds(1)(a);
	await first.server.stop(true);

	// A new driver knows no saved sessions.
	const second = await serve(
		{ streams: ["math"] },
		{ studyDir: first.dir, create: false },
	);
	const b = await Client.subscribe(second.server, first.id);
	await ask(second.api, first.id, "dos");
	await turnEnds(1)(b);
	expect(second.driver.started[0]).toMatchObject({ resumed: false });
	expect(second.driver.started[0]?.seed).toContain("## Tú\n\nuno");
});

test("an edit while the server runs reloads the thread and reseeds the live agent", async () => {
	const { server, api, id, dir, driver } = await serve({ streams: ["math"] });
	const client = await Client.subscribe(server, id);
	await ask(api, id, "uno");
	await turnEnds(1)(client);
	const { path } = await sessionFile(dir, api);
	await writeFile(
		path,
		`${await readFile(path, "utf8")}\nUna línea agregada.\n`,
	);

	// The watcher pushes a fresh snapshot to the session's clients.
	await client.until(
		(m) =>
			m.t === "snapshot" &&
			(m.turns[0]?.blocks[0]?.text.endsWith("Una línea agregada.") ?? false),
	);
	await ask(api, id, "dos");
	await client.until(
		(m) =>
			m.t === "ev" &&
			m.e.type === "turn_end" &&
			m.seq > client.snapshot.seq + 3,
	);
	expect(driver.started).toHaveLength(2);
	expect(driver.started[1]).toMatchObject({ resumed: false });
	expect(driver.started[1]?.seed).toContain("Una línea agregada.");
	// And the edit is still there, with the new turn after it.
	const { entries } = parse(await readFile(path, "utf8"));
	expect(entries.map((e) => e.kind)).toEqual([
		"user",
		"answer",
		"user",
		"answer",
	]);
});

test("an interrupted answer is written, marked as interrupted", async () => {
	const gate = hold(6);
	const { server, api, id, dir } = await serve({
		streams: ["math"],
		pace: gate.pace,
	});
	const client = await Client.subscribe(server, id);
	await ask(api, id, "uno");
	await gate.arrived;
	await api(`/api/sessions/${id}/interrupt`, {});
	gate.release();
	await turnEnds(1)(client);
	const { md } = await sessionFile(dir, api);
	expect(await md()).toContain("## Claude *(interrumpida)*");
	const { entries } = parse(await md());
	expect(entries[1]).toMatchObject({ kind: "answer", reason: "interrupted" });
});

test("an idle agent is closed, and the next send resumes it", async () => {
	const { server, api, id, driver } = await serve(
		{ streams: ["math"] },
		{ idleMs: 50 },
	);
	const client = await Client.subscribe(server, id);
	await ask(api, id, "uno");
	await turnEnds(1)(client);
	await Bun.sleep(120);
	await ask(api, id, "dos");
	await turnEnds(2)(client);
	expect(driver.started).toHaveLength(2);
	expect(driver.started[1]).toMatchObject({
		sdkSessionId: driver.started[0]?.sdkSessionId,
		resumed: true,
	});
});

test("PATCH changes the title and mode; clients get a meta event", async () => {
	const { server, api, id, dir } = await serve({ streams: ["math"] });
	const client = await Client.subscribe(server, id);
	const res = await api(
		`/api/sessions/${id}`,
		{ title: "Bernoulli", mode: "review" },
		"PATCH",
	);
	expect(res.status).toBe(200);
	expect(await res.json()).toMatchObject({
		title: "Bernoulli",
		mode: "review",
	});
	await client.untilEvent((e) => e.type === "meta");
	expect(client.view().meta).toMatchObject({
		title: "Bernoulli",
		mode: "review",
	});
	const { md } = await sessionFile(dir, api);
	expect(parse(await md()).meta).toMatchObject({
		title: "Bernoulli",
		mode: "review",
	});

	await api(`/api/sessions/${id}`, { mode: null }, "PATCH");
	expect(parse(await md()).meta.mode).toBeUndefined();
	expect((await api(`/api/sessions/${id}`, {}, "PATCH")).status).toBe(400);
	expect(
		(await api("/api/sessions/nope", { title: "x" }, "PATCH")).status,
	).toBe(404);
});

test("courses are the folder's top-level folders", async () => {
	const { api, dir } = await serve({ streams: [] }, { create: false });
	await mkdir(join(dir, "logica"));
	await mkdir(join(dir, "inbox"));
	await mkdir(join(dir, ".claude"));
	await writeFile(join(dir, "suelto.md"), "x");
	await mkdir(join(dir, "logica", "sessions"));
	await writeFile(
		join(dir, "logica", "sessions", "roto.md"),
		"sin front matter",
	);
	await api("/api/sessions", { course: "probabilidad", title: "Varianza" });
	const state = (await (await api("/api/state")).json()) as StateResponse;
	expect(state.folder).toBe(dir);
	expect(state.courses).toEqual(["logica", "probabilidad"]);
	expect(state.sessions.map((s) => s.title)).toEqual(["Varianza"]);
	expect(state.sessions[0]?.updated).toBeString();
	const files = await Array.fromAsync(
		new Bun.Glob("probabilidad/sessions/*.md").scan({ cwd: dir }),
	);
	expect(files[0]).toMatch(/-varianza\.md$/);
	for (const course of ["inbox", ".claude", "a/b", "..", " x"]) {
		expect((await api("/api/sessions", { course })).status).toBe(400);
	}
});

test("first run: no folder until one is chosen, then it is saved", async () => {
	const saved: string[] = [];
	const { api } = await start({
		port: 0,
		distDir: null,
		driver: new FakeDriver({ streams: ["math"] }),
		studyDir: null,
		saveStudyDir: (path) => saved.push(path),
	});
	const base = await studyDir();
	{
		expect(await (await api("/api/state")).json()).toEqual({
			folder: null,
			courses: [],
			sessions: [],
		});
		expect((await api("/api/sessions", { course: "x" })).status).toBe(409);
		for (const path of ["relativa/x", "~", "/"]) {
			expect((await api("/api/folder", { path })).status).toBe(400);
		}
		const chosen = join(base, "Estudio");
		const res = await api("/api/folder", { path: chosen });
		expect(res.status).toBe(201);
		expect(saved).toEqual([chosen]);
		expect((await api("/api/folder", { path: chosen })).status).toBe(409);
		expect((await api("/api/sessions", { course: "general" })).status).toBe(
			201,
		);
		const state = (await (await api("/api/state")).json()) as StateResponse;
		expect(state.courses).toEqual(["general"]);
	}
});

test("a message sent mid-turn is written after the running turn's answer", async () => {
	const gate = hold(3);
	const first = await serve({ streams: ["math"], pace: gate.pace });
	const a = await Client.subscribe(first.server, first.id);
	await ask(first.api, first.id, "A");
	await gate.arrived;
	await ask(first.api, first.id, "B");
	gate.release();
	await turnEnds(2)(a);
	const { path } = await sessionFile(first.dir, first.api);
	const { entries } = parse(await readFile(path, "utf8"));
	expect(entries.map((e) => (e.kind === "user" ? e.text : e.kind))).toEqual([
		"A",
		"answer",
		"B",
		"answer",
	]);
	await first.server.stop(true);

	// After a restart each answer is still under its own question.
	const second = await serve(
		{ streams: [] },
		{ driver: first.driver, studyDir: first.dir, create: false },
	);
	const b = await Client.subscribe(second.server, first.id);
	expect(b.snapshot.turns.map((t) => t.user.text)).toEqual(["A", "B"]);
	expect(b.snapshot.turns.map((t) => t.end?.reason)).toEqual([
		"completed",
		"completed",
	]);
});

test("Stop pressed while the agent is still starting interrupts the turn", async () => {
	let release = () => {};
	class SlowStart extends FakeDriver {
		override async has(id: string) {
			await new Promise<void>((resolve) => (release = resolve));
			return super.has(id);
		}
	}
	const driver = new SlowStart({ streams: ["math"] });
	const first = await serve({ streams: [] }, { driver });
	const a = await Client.subscribe(first.server, first.id);
	await ask(first.api, first.id, "uno");
	await turnEnds(1)(a);
	await first.server.stop(true);

	// After a restart the first send asks whether it can resume: hold that.
	const second = await serve(
		{ streams: [] },
		{ driver, studyDir: first.dir, create: false },
	);
	const b = await Client.subscribe(second.server, first.id);
	await ask(second.api, first.id, "dos");
	await b.untilEvent((e) => e.type === "turn_start");
	const res = await second.api(`/api/sessions/${first.id}/interrupt`, {});
	expect(await res.json()).toEqual({ interrupted: true });
	release();
	await turnEnds(1)(b);
	expect(b.view().turns.at(-1)?.end?.reason).toBe("interrupted");
});

test("a saved folder that is gone brings back the first-run screen", async () => {
	const { api } = await start({
		port: 0,
		distDir: null,
		driver: new FakeDriver({ streams: [] }),
		studyDir: join(await studyDir(), "ya-no-existe"),
	});
	const state = await (await api("/api/state")).json();
	expect(state.folder).toBeNull();
});

test("the first-run screen refuses folders that would give Claude too much", async () => {
	const { api } = await start({
		port: 0,
		distDir: null,
		driver: new FakeDriver({ streams: [] }),
		studyDir: null,
	});
	for (const path of ["/Users", "~/.ssh", "~/Library/Estudio", "~/x/.oculta"]) {
		const res = await api("/api/folder", { path });
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("too_broad");
	}
});
