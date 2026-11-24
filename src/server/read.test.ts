/**
 * Integration for the Read view's server side: study files over `/files/*`
 * (with byte ranges, inside the jail), the materials list, notes, anchors
 * reaching Claude, and thinking and tool rows that survive a restart.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Block, MaterialsResponse } from "../shared/protocol.ts";
import { parseRange } from "./http.ts";
import { Client, cleanUp, serve, studyDir, turnEnds } from "./testing.ts";
import { parse } from "./transcript/transcript.ts";

afterEach(cleanUp);

/** 4 KiB of distinct bytes, so a wrong offset shows. */
const BYTES = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7 + 3) % 256);

async function withMaterials() {
	const served = await serve({ streams: ["math"] });
	const dir = join(served.dir, "probabilidad", "materials");
	await mkdir(join(dir, "parcial"), { recursive: true });
	await writeFile(join(dir, "apunte 1.pdf"), BYTES);
	await writeFile(join(dir, "parcial", "modelo.PDF"), "%PDF-1.4");
	await writeFile(join(dir, "notas.txt"), "no es un PDF");
	return served;
}

const sessionPath = async (dir: string) => {
	const [file] = await Array.fromAsync(
		new Bun.Glob("*/sessions/*.md").scan({ cwd: dir }),
	);
	return join(dir, file ?? "");
};

test("/files/* answers a Range request with 206 and exactly those bytes", async () => {
	const { api } = await withMaterials();
	const url = "/files/probabilidad/materials/apunte%201.pdf";

	const whole = await api(url);
	expect(whole.status).toBe(200);
	expect(whole.headers.get("content-type")).toBe("application/pdf");
	expect(whole.headers.get("accept-ranges")).toBe("bytes");
	expect(new Uint8Array(await whole.arrayBuffer())).toEqual(BYTES);

	const part = await api(url, undefined, "GET", { range: "bytes=1000-1999" });
	expect(part.status).toBe(206);
	expect(part.headers.get("content-range")).toBe("bytes 1000-1999/4096");
	expect(part.headers.get("content-length")).toBe("1000");
	expect(new Uint8Array(await part.arrayBuffer())).toEqual(
		BYTES.slice(1000, 2000),
	);

	const tail = await api(url, undefined, "GET", { range: "bytes=-96" });
	expect(tail.status).toBe(206);
	expect(new Uint8Array(await tail.arrayBuffer())).toEqual(BYTES.slice(4000));

	const past = await api(url, undefined, "GET", { range: "bytes=5000-" });
	expect(past.status).toBe(416);
	expect(past.headers.get("content-range")).toBe("bytes */4096");
});

test("/files/* never leaves the study folder", async () => {
	const { api, dir, server, cookie } = await withMaterials();
	const outside = await studyDir();
	await writeFile(join(outside, "secret.pdf"), "secret");
	await symlink(
		join(outside, "secret.pdf"),
		join(dir, "probabilidad/materials/link.pdf"),
	);
	await symlink(outside, join(dir, "probabilidad/materials/afuera"));
	await mkdir(join(dir, ".claude"), { recursive: true });
	await writeFile(join(dir, ".claude", "settings.json"), "{}");

	const refused = [
		"/files/probabilidad/materials/link.pdf",
		"/files/probabilidad/materials/afuera/secret.pdf",
		"/files/probabilidad/materials/..%2F..%2F..%2Fsecret.pdf",
		`/files/${encodeURIComponent(join(outside, "secret.pdf"))}`,
		"/files/.claude/settings.json",
		"/files/probabilidad/materials",
		"/files/probabilidad/materials/nada.pdf",
	];
	for (const path of refused) {
		const res = await api(path);
		expect({ path, status: res.status }).toEqual({ path, status: 404 });
	}
	// `fetch` normalizes `..` away; a raw request line doesn't.
	const raw = await rawGet(server.url, "/files/../secret.pdf", cookie);
	expect(raw).toStartWith("HTTP/1.1 404");

	// Without the device cookie, nothing at all.
	const unpaired = await api(
		"/files/probabilidad/materials/apunte%201.pdf",
		undefined,
		"GET",
		{ cookie: "" },
	);
	expect(unpaired.status).toBe(403);
});

test("a file that isn't a PDF or an image is never served as a page", async () => {
	const { api, dir } = await withMaterials();
	await writeFile(join(dir, "probabilidad/materials/x.html"), "<script>");
	const res = await api("/files/probabilidad/materials/x.html");
	expect(res.status).toBe(200);
	expect(res.headers.get("content-type")).toBe("application/octet-stream");
	expect(res.headers.get("content-disposition")).toBe("attachment");
	expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	expect(res.headers.get("content-security-policy")).toContain("sandbox");
});

test("the materials list holds the course's PDFs", async () => {
	const { api } = await withMaterials();
	const res = await api("/api/courses/probabilidad/materials");
	expect(((await res.json()) as MaterialsResponse).files).toEqual([
		{ path: "probabilidad/materials/apunte 1.pdf", name: "apunte 1.pdf" },
		{ path: "probabilidad/materials/parcial/modelo.PDF", name: "modelo.PDF" },
	]);
	const none = await api("/api/courses/..%2F/materials");
	expect(((await none.json()) as MaterialsResponse).files).toEqual([]);
});

test("parseRange", () => {
	expect(parseRange("bytes=0-0", 10)).toEqual([0, 0]);
	expect(parseRange("bytes=5-", 10)).toEqual([5, 9]);
	expect(parseRange("bytes=5-100", 10)).toEqual([5, 9]);
	expect(parseRange("bytes=-3", 10)).toEqual([7, 9]);
	expect(parseRange("bytes=-30", 10)).toEqual([0, 9]);
	expect(parseRange("bytes=9-5", 10)).toBeNull();
	expect(parseRange("bytes=10-", 10)).toBeNull();
	expect(parseRange("bytes=0-1,4-5", 10)).toBeNull();
	expect(parseRange("items=0-1", 10)).toBeNull();
	expect(parseRange("bytes=-", 10)).toBeNull();
});

const anchor = {
	path: "probabilidad/materials/apunte 1.pdf",
	page: 3,
	text: "Sea X una variable aleatoria\ncon E[X] = p.",
};

test("a note is stored as a `> [!note]` entry, broadcast, and sent to Claude with the next message", async () => {
	const { server, api, id, dir, driver } = await serve({ streams: ["math"] });
	const client = await Client.subscribe(server, id);
	// A live agent first, so the note goes to it rather than through a reseed.
	await api(`/api/sessions/${id}/messages`, { clientMsgId: "a", text: "uno" });
	await turnEnds(1)(client);

	const res = await api(`/api/sessions/${id}/notes`, {
		anchor,
		text: "Repasar para el parcial",
	});
	expect(res.status).toBe(201);
	const { id: noteId } = (await res.json()) as { id: string };
	await client.untilEvent((e) => e.type === "note");
	expect(client.view().notes).toEqual([
		{ id: noteId, anchor, text: "Repasar para el parcial" },
	]);

	const md = await readFile(await sessionPath(dir), "utf8");
	expect(md).toContain(
		[
			"## Nota",
			"",
			"> [!note] [apunte 1.pdf, p. 3](../../probabilidad/materials/apunte%201.pdf#page=3)",
			"> > Sea X una variable aleatoria",
			"> > con E[X] = p.",
			">",
			"> Repasar para el parcial",
		].join("\n"),
	);
	expect(parse(md).entries.at(-1)).toEqual({
		kind: "note",
		anchor,
		text: "Repasar para el parcial",
	});

	await api(`/api/sessions/${id}/messages`, { clientMsgId: "b", text: "dos" });
	await turnEnds(2)(client);
	// Same agent: the note went ahead of the message, not through a reseed.
	expect(driver.started).toHaveLength(1);
	expect(driver.pushed[1]).toContain("<notes>");
	expect(driver.pushed[1]).toContain(
		'they marked "Sea X una variable aleatoria con E[X] = p.": Repasar para el parcial',
	);
	expect(driver.pushed[1]).toEndWith("dos");
	// And only once.
	await api(`/api/sessions/${id}/messages`, { clientMsgId: "c", text: "tres" });
	await turnEnds(3)(client);
	expect(driver.pushed[2]).toBe("tres");
});

test("a note with no text is a highlight; an empty quote is refused", async () => {
	const { api, id, dir } = await serve({ streams: ["math"] });
	const ok = await api(`/api/sessions/${id}/notes`, { anchor });
	expect(ok.status).toBe(201);
	expect(parse(await readFile(await sessionPath(dir), "utf8")).entries).toEqual(
		[{ kind: "note", anchor }],
	);
	const empty = await api(`/api/sessions/${id}/notes`, {
		anchor: { ...anchor, text: "" },
	});
	expect(empty.status).toBe(400);
	const missing = await api("/api/sessions/nope/notes", { anchor });
	expect(missing.status).toBe(404);
});

test("an anchored question reaches Claude with its passage, file and page", async () => {
	const { server, api, id, driver, dir } = await serve({ streams: ["math"] });
	const client = await Client.subscribe(server, id);
	const res = await api(`/api/sessions/${id}/messages`, {
		clientMsgId: "a",
		text: "explicá esto",
		anchor,
	});
	expect(res.status).toBe(202);
	await turnEnds(1)(client);
	expect(client.view().turns[0]?.user.anchor).toEqual(anchor);
	expect(driver.pushed[0]).toBe(
		[
			'<passage path="probabilidad/materials/apunte 1.pdf" page="3">',
			"The student selected this passage on the page they are reading and asks about it:",
			"Sea X una variable aleatoria\ncon E[X] = p.",
			"</passage>",
			"",
			"explicá esto",
		].join("\n"),
	);
	const md = await readFile(await sessionPath(dir), "utf8");
	expect(md).toContain(
		"## Tú\n\n> [apunte 1.pdf, p. 3](../../probabilidad/materials/apunte%201.pdf#page=3)\n> Sea X",
	);
});

/** A block as the thread shows it, without its id. */
const shown = (b: Block) => ({
	kind: b.kind,
	name: b.name,
	text: b.kind === "tool" ? JSON.stringify(JSON.parse(b.text)) : b.text.trim(),
	result: b.result,
});

test("thinking and tool rows survive a server restart", async () => {
	const first = await serve({ streams: ["calc"] });
	const a = await Client.subscribe(first.server, first.id);
	await first.api(`/api/sessions/${first.id}/messages`, {
		clientMsgId: "a",
		text: "binomcdf(10, 0.3, 4)",
	});
	await turnEnds(1)(a);
	const before = a.view().turns[0]?.blocks ?? [];
	expect(before.map((b) => b.kind)).toContain("thinking");
	expect(before.map((b) => b.kind)).toContain("tool");
	await first.server.stop(true);

	const second = await serve(
		{ streams: [] },
		{ driver: first.driver, studyDir: first.dir, create: false },
	);
	const b = await Client.subscribe(second.server, first.id);
	const after = b.snapshot.turns[0]?.blocks ?? [];
	expect(after.map(shown)).toEqual(
		before.filter((x) => x.kind !== "thinking" || x.text.trim()).map(shown),
	);
	expect(after.find((x) => x.kind === "tool")?.result?.ok).toBe(true);

	const md = await readFile(await sessionPath(first.dir), "utf8");
	expect(md).toContain("> [!thinking]- Pensó\n> ");
	expect(md).toContain("> [!tool] mcp__study__calc\n> {");
});

/** A GET with this exact path on the request line, which `fetch` would normalize. */
async function rawGet(base: URL, path: string, cookie: string) {
	const chunks: string[] = [];
	await new Promise<void>((resolve, reject) => {
		Bun.connect({
			hostname: base.hostname,
			port: Number(base.port),
			socket: {
				open(s) {
					s.write(
						`GET ${path} HTTP/1.1\r\nHost: ${base.host}\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`,
					);
				},
				data(_, d) {
					chunks.push(new TextDecoder().decode(d));
				},
				close: () => resolve(),
				error: (_, e) => reject(e),
			},
		}).catch(reject);
	});
	return chunks.join("");
}
