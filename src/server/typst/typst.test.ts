/**
 * Typst on the server (step 12): blocks to SVG (and how fast), what a
 * hostile source can't do, `.typ` previews inside the jail, and the session
 * export, compiled by our Worker and, when it is installed, the `typst` CLI.
 */
import { afterAll, afterEach, expect, test } from "bun:test";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import type {
	ExportResponse,
	MaterialsResponse,
} from "../../shared/protocol.ts";
import { cleanUp, serve, studyDir } from "../testing.ts";
import {
	type Entry,
	format,
	type TranscriptMeta,
} from "../transcript/transcript.ts";
import { exportPath, str, text, toTypst } from "./export.ts";
import { MITEX_IMPORT, Typst } from "./typst.ts";

afterEach(cleanUp);

const typst = new Typst({ svgTimeoutMs: 3000, pdfTimeoutMs: 5000 });
afterAll(() => typst.close());

const svgOf = async (source: string) => {
	const out = await typst.svg(source);
	if (!out.ok) throw new Error(out.error);
	return out.value;
};
const errorOf = async (source: string) => {
	const out = await typst.svg(source);
	expect(out.ok).toBe(false);
	return out.ok ? "" : out.error;
};

test("a block renders to SVG: cold, then warm in well under a second", async () => {
	const block = "$ A = mat(1, 2; 3, 4), quad det(A) = -2 $";
	let t = performance.now();
	const cold = await svgOf(block);
	const coldMs = performance.now() - t;
	const warm: number[] = [];
	for (let i = 0; i < 5; i++) {
		t = performance.now();
		await svgOf(`${block}\n// ${i}`);
		warm.push(performance.now() - t);
	}
	const warmMs = Math.max(...warm);
	console.log(
		`typst block → SVG: cold ${coldMs.toFixed(0)} ms (Worker start included), warm ${warm.map((w) => w.toFixed(1)).join(", ")} ms`,
	);
	expect(cold).toStartWith("<svg");
	expect(cold).toContain("<use");
	expect(warmMs).toBeLessThan(1000);
});

test("a block sees no files and no packages", async () => {
	expect(await errorOf('#read("../../../../etc/passwd")')).toBe(
		"línea 1: no se puede leer un archivo fuera de la carpeta",
	);
	expect(await errorOf('#read("/etc/passwd")')).toBe(
		"línea 1: el archivo no existe o no se puede leer desde aquí",
	);
	expect(await errorOf('#image("/Users/x/foto.png")')).toContain("no existe");
	expect(await errorOf('#eval("read(\\"/etc/hosts\\")")')).toContain(
		"no existe",
	);
	expect(await errorOf('#import "@preview/cetz:0.3.0": canvas')).toBe(
		"línea 1: el paquete @preview/cetz:0.3.0 no está disponible: Lemma no descarga paquetes de Typst",
	);
	// Even the package exports use is not for blocks.
	expect(await errorOf(`#import "${MITEX_IMPORT}": mi`)).toContain(
		"no está disponible",
	);
	// Errors point at the block's own lines, not the prelude's.
	expect(await errorOf("hola\n\n$ x^2 + #let")).toStartWith("línea 3:");
});

test("a block that runs away is stopped, and the next one still renders", async () => {
	const t = performance.now();
	// 10⁸ empty iterations: minutes of work.
	expect(
		await errorOf("#for i in range(10000) { for j in range(10000) { } }"),
	).toBe("Typst se detuvo tras 3 s");
	expect(performance.now() - t).toBeLessThan(4500);
	// A loop Typst can see through is its own error.
	expect(await errorOf("#while true { }")).toContain("always true");
	// A trap in the WebAssembly (an allocation too big) kills the Worker too,
	// unless the clock gets there first.
	expect(await errorOf("#for i in range(100000000) { }")).toMatch(
		/^Typst (falló|se detuvo)/,
	);
	expect(await svgOf("$ y $")).toStartWith("<svg");
}, 20_000);

test("a long block is refused before it compiles", async () => {
	expect(await errorOf("a".repeat(20_001))).toContain("demasiado largo");
});

test("Read lists .typ files and the server compiles them inside the jail", async () => {
	const { api, dir } = await serve({ streams: ["math"] });
	const notes = join(dir, "probabilidad", "notes");
	await mkdir(notes, { recursive: true });
	await mkdir(join(dir, "probabilidad", "materials"), { recursive: true });
	await mkdir(join(dir, ".claude"), { recursive: true });
	await writeFile(join(dir, ".claude", "secreto.txt"), "no");
	await writeFile(join(notes, "comun.typ"), "#let marca = [*importante*]");
	await writeFile(
		join(notes, "resumen.typ"),
		'#import "comun.typ": marca\n= Resumen\nUn resultado #marca: $P(A) = 1 - P(A^c)$.',
	);
	await writeFile(
		join(notes, "secreto.typ"),
		'#read("../../.claude/secreto.txt")',
	);
	await writeFile(join(notes, "fuera.typ"), '#read("../../../afuera.txt")');
	const outside = await studyDir();
	await writeFile(join(outside, "x.txt"), "afuera");
	await symlink(join(outside, "x.txt"), join(notes, "enlace.txt"));
	await writeFile(join(notes, "enlace.typ"), '#read("enlace.txt")');
	await writeFile(join(dir, "probabilidad", "materials", "guia.typ"), "= Guía");
	await writeFile(join(notes, "apunte.md"), "# no");

	const listed = (await (
		await api("/api/courses/probabilidad/materials")
	).json()) as MaterialsResponse;
	expect(listed.files.map((f) => f.path)).toEqual([
		"probabilidad/materials/guia.typ",
		"probabilidad/notes/comun.typ",
		"probabilidad/notes/enlace.typ",
		"probabilidad/notes/fuera.typ",
		"probabilidad/notes/resumen.typ",
		"probabilidad/notes/secreto.typ",
	]);

	const pdf = await api("/api/typst/pdf/probabilidad/notes/resumen.typ");
	expect(pdf.status).toBe(200);
	expect(pdf.headers.get("content-type")).toBe("application/pdf");
	expect(pdf.headers.get("content-security-policy")).toContain("sandbox");
	expect(pdf.headers.get("accept-ranges")).toBeNull();
	expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe(
		"%PDF-",
	);

	for (const [file, message] of [
		["secreto", "el archivo no existe"],
		["fuera", "fuera de la carpeta"],
		["enlace", "el archivo no existe"],
	] as const) {
		const res = await api(`/api/typst/pdf/probabilidad/notes/${file}.typ`);
		expect({ file, status: res.status }).toEqual({ file, status: 422 });
		const body = (await res.json()) as { error: { message: string } };
		expect(body.error.message).toContain(message);
	}
	for (const path of [
		"/api/typst/pdf/probabilidad/notes/apunte.md",
		"/api/typst/pdf/probabilidad/notes/nada.typ",
		"/api/typst/pdf/.claude/x.typ",
		"/api/typst/pdf/probabilidad/notes/..%2F..%2F..%2Fx.typ",
	]) {
		const res = await api(path);
		expect({ path, status: res.status }).toEqual({ path, status: 404 });
	}
	const unpaired = await api(
		"/api/typst/pdf/probabilidad/notes/resumen.typ",
		undefined,
		"GET",
		{ cookie: "" },
	);
	expect(unpaired.status).toBe(403);
});

test("POST /api/typst/svg draws a block, or answers 422 with the error", async () => {
	const { api } = await serve({ streams: ["math"] }, { create: false });
	const ok = await api("/api/typst/svg", { source: "$ x^2 $" });
	expect(ok.status).toBe(200);
	expect(((await ok.json()) as { svg: string }).svg).toStartWith("<svg");
	const bad = await api("/api/typst/svg", { source: "$ x" });
	expect(bad.status).toBe(422);
	expect(((await bad.json()) as { error: { code: string } }).error.code).toBe(
		"typst_error",
	);
	const unpaired = await api("/api/typst/svg", { source: "x" }, "POST", {
		cookie: "",
	});
	expect(unpaired.status).toBe(403);
});

// ── Export ──────────────────────────────────────────────────────────────────

const META: TranscriptMeta = {
	id: "00000000-0000-4000-8000-000000000001",
	course: "probabilidad",
	title: "Normal y autómatas",
	created: "2026-11-26T12:00:00.000Z",
};

const PHOTO = "probabilidad/sessions/2026-11-26-normal/001-photo.png";

/** A session with math, every kind of block, a note and a photo. */
const ENTRIES: Entry[] = [
	{
		kind: "user",
		text: "¿Cuánto vale $P(X>1{,}5)$ si $X\\sim N(0,1)$?\nY el AFD de paridad.",
		anchor: {
			path: "probabilidad/materials/apunte.pdf",
			page: 3,
			text: "Teorema 3. La normal estándar…",
		},
		attachments: [PHOTO],
	},
	{
		kind: "answer",
		reason: "completed",
		parts: [
			{ kind: "thinking", text: "Uso calc." },
			{
				kind: "tool",
				name: "mcp__study__calc",
				input: '{"expr":"1 - normcdf(1.5)"}',
				result: { ok: true, summary: "0.0668" },
			},
			{
				kind: "text",
				text: [
					"## Resultado",
					"",
					"$$",
					"\\begin{aligned}",
					"P(X>1{,}5) &= 1-\\Phi(1{,}5) \\\\",
					"&\\approx 0{,}0668",
					"\\end{aligned}",
					"$$",
					"",
					'Con *énfasis*, **negrita**, `código`, #include "x" y @ref 1 < 2 > 0 // no comentario, y 10 dólares.',
					"",
					"```dot",
					'digraph { rankdir=LR; q0 -> q1 [label="0"]; q1 -> q0 [label="0"] }',
					"```",
					"",
					"```typst",
					"$ mat(1, 2; 3, 4) $",
					"#set text(fill: blue)",
					"```",
					"",
					"```plot",
					'{"xDomain": [-4, 4], "yDomain": [0, 0.45], "items": [{"fn": "normpdf(x)"}]}',
					"```",
					"",
					"```typst",
					'#read("/etc/passwd")',
					"```",
					"",
					"| $p$ | $\\neg p$ |",
					"|---|---|",
					"| V | F |",
					"| W |",
					"",
					"**Nota**(opcional) y $f$(x).",
					"",
					// Text after an inline expression must stay text.
					'Mira **a**(panic("INJECTED")) y **a**.text y $f$(panic("INJECTED")) y **a**(read("x")).',
					"",
					"```typst",
					"] #set text(fill: red) #[",
					"```",
					"",
					"```typst",
					"#show: _ => []",
					"```",
					"",
					"- uno",
					"- dos",
					"",
					"3. tres",
					"4. cuatro",
				].join("\n"),
			},
		],
	},
	{
		kind: "note",
		anchor: {
			path: "probabilidad/materials/apunte.pdf",
			page: 4,
			text: "la simetría de la normal",
		},
		text: "repasar para el parcial",
	},
	{ kind: "user", text: "¿Y el complemento?" },
	{
		kind: "answer",
		reason: "interrupted",
		parts: [{ kind: "text", text: "Es $\\Phi(1{,}5)$" }],
	},
];

/** A real 16×16 grey PNG, so Typst has an image to decode. */
function png(): Uint8Array {
	const chunk = (type: string, data: Uint8Array) => {
		const body = new Uint8Array([...new TextEncoder().encode(type), ...data]);
		const out = new Uint8Array(12 + data.length);
		const view = new DataView(out.buffer);
		view.setUint32(0, data.length);
		out.set(body, 4);
		view.setUint32(8 + data.length, Bun.hash.crc32(body));
		return out;
	};
	const header = new Uint8Array(13);
	const h = new DataView(header.buffer);
	h.setUint32(0, 16);
	h.setUint32(4, 16);
	header.set([8, 0, 0, 0, 0], 8);
	const rows = new Uint8Array(16 * 17).map((_, i) => (i % 17 === 0 ? 0 : 160));
	return new Uint8Array([
		0x89,
		0x50,
		0x4e,
		0x47,
		0x0d,
		0x0a,
		0x1a,
		0x0a,
		...chunk("IHDR", header),
		...chunk("IDAT", deflateSync(rows)),
		...chunk("IEND", new Uint8Array()),
	]);
}

test("text and strings are escaped for Typst", () => {
	expect(text('#include "x" $1 *a* _b_ @r <l> [c] // d \\ e - f')).toBe(
		'\\#include "x" \\$1 \\*a\\* \\_b\\_ \\@r \\<l\\> \\[c\\] \\/\\/ d \\\\ e \\- f',
	);
	expect(str('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
});

test("a session becomes a Typst document", async () => {
	const typPath = exportPath(
		"probabilidad/sessions/2026-11-26-normal.md",
		"probabilidad",
	);
	expect(typPath).toBe("probabilidad/exports/2026-11-26-normal.typ");
	const doc = await toTypst(META, ENTRIES, {
		typPath,
		draw: async (kind, src) =>
			kind === "typst" && !src.includes("read")
				? `#[\n${src}\n]`
				: kind === "dot"
					? "#DOT"
					: null,
	});
	expect(doc).toStartWith(`#import "${MITEX_IMPORT}": mitex, mi\n`);
	expect(doc).toContain("= Normal y autómatas");
	// The question: its passage, its text with math and a line break, its photo.
	expect(doc).toContain("#fuente[apunte.pdf, p. 3]");
	expect(doc).toContain(
		'¿Cuánto vale #mi("P(X>1\\\\mathord{,}5)"); si #mi("X\\\\sim N(0,1)");? \\\nY el AFD de paridad.',
	);
	expect(doc).toContain(
		'#image("../sessions/2026-11-26-normal/001-photo.png", width: 60%)',
	);
	// The answer: no thinking or tool rows; math through mitex; text escaped.
	expect(doc).not.toContain("Uso calc");
	expect(doc).not.toContain("normcdf");
	expect(doc).toContain("=== Resultado");
	expect(doc).toContain(
		'#align(center, mitex("\\\\begin{aligned}\\nP(X>1\\\\mathord{,}5)',
	);
	expect(doc).toContain(
		'Con #emph[énfasis];, #strong[negrita];, #raw("código");, \\#include "x" y \\@ref 1 \\< 2 \\> 0 \\/\\/ no comentario, y 10 dólares.',
	);
	// Blocks: drawn when they can be, their source otherwise.
	expect(doc).toContain("#DOT");
	expect(doc).toContain("#[\n$ mat(1, 2; 3, 4) $\n#set text(fill: blue)\n]");
	expect(doc).toContain(
		"#fuente[(gráfico: se muestra su fuente)]\n\n```plot\n",
	);
	expect(doc).toContain(
		'#fuente[(bloque Typst: se muestra su fuente)]\n\n```typ\n#read("/etc/passwd")\n```',
	);
	expect(doc).toContain("#table(columns: 2,");
	expect(doc).toContain("- uno\n- dos");
	expect(doc).toContain("#[\n#set enum(start: 3)\n+ tres\n+ cuatro\n]");
	// The note, and the interrupted answer.
	expect(doc).toContain("#fuente[Nota · apunte.pdf, p. 4]");
	expect(doc).toContain("repasar para el parcial");
	expect(doc).toContain("(respuesta interrumpida)");
});

test("Exportar writes the .typ and its PDF, which the typst CLI compiles too", async () => {
	const { api, dir, id } = await serve({ streams: ["math"] });
	// Replace the new session's file with the seeded one, same id.
	const [file] = await Array.fromAsync(
		new Bun.Glob("probabilidad/sessions/*.md").scan({ cwd: dir }),
	);
	const transcript = join(dir, file ?? "");
	const photo = join(dir, file?.replace(/\.md$/, "") ?? "", "001-photo.png");
	await mkdir(join(photo, ".."), { recursive: true });
	await writeFile(photo, png());
	const seeded = format(
		{ ...META, id },
		ENTRIES.map((e) =>
			e.kind === "user" && e.attachments
				? { ...e, attachments: [`${file?.replace(/\.md$/, "")}/001-photo.png`] }
				: e,
		),
	);
	await writeFile(transcript, seeded);

	const res = await api(`/api/sessions/${id}/export`, undefined, "POST");
	expect(res.status).toBe(200);
	const out = (await res.json()) as ExportResponse;
	const stem = (file ?? "").split("/").pop()?.replace(/\.md$/, "");
	expect(out).toEqual({
		typ: `probabilidad/exports/${stem}.typ`,
		pdf: `probabilidad/exports/${stem}.pdf`,
	});
	const typ = await readFile(join(dir, out.typ), "utf8");
	// Graphviz drew the automaton; the typst block went in as Typst.
	expect(typ).toContain('image(bytes("<?xml');
	expect(typ).toContain(
		'#eval("$ mat(1, 2; 3, 4) $\\n#set text(fill: blue)", mode: "markup")',
	);
	// A block that tries to close its scope doesn't compile alone: source.
	expect(typ).toContain("```typ\n] #set text(fill: red) #[\n```");
	// One that compiles stays inside its own string, show rules and all.
	expect(typ).toContain('#eval("#show: _ => []", mode: "markup")');
	expect(typ).toContain("¿Y el complemento?");
	expect(typ).toContain(
		`#image("../sessions/${stem}/001-photo.png", width: 60%)`,
	);
	const pdf = await readFile(join(dir, out.pdf ?? ""));
	expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe("%PDF-");

	const cli = Bun.which("typst");
	if (!cli) {
		console.log("typst CLI not installed: skipped the CLI compile");
		return;
	}
	const run = Bun.spawnSync([
		cli,
		"compile",
		"--root",
		dir,
		"--package-path",
		join(import.meta.dir, "assets", "packages"),
		"--ignore-system-fonts",
		join(dir, out.typ),
		join(dir, "cli.pdf"),
	]);
	console.log(
		`typst compile ${out.typ}: exit ${run.exitCode}${run.stderr.length ? `\n${run.stderr}` : ""}`,
	);
	expect(run.exitCode).toBe(0);
});

test("an export of an unknown session is a 404", async () => {
	const { api } = await serve({ streams: ["math"] });
	const res = await api("/api/sessions/nope/export", undefined, "POST");
	expect(res.status).toBe(404);
});
