import { expect, test } from "bun:test";
import {
	bodyHash,
	type Entry,
	format,
	parse,
	partsOf,
	split,
	type TranscriptMeta,
} from "./transcript.ts";

const meta: TranscriptMeta = {
	id: "3f2a9c1e-0000-4000-8000-000000000001",
	course: "probabilidad",
	title: "Varianza: Bernoulli y binomial",
	created: "2026-11-22T18:30:00.000Z",
	mode: "explain",
	sdk_session_id: "0e5a0000-0000-4000-8000-000000000002",
	sdk_body_hash: "0e51",
};

const anchor = {
	path: "probabilidad/materials/apunte (1).pdf",
	page: 3,
	text: "Sea $X \\sim \\mathrm{Bernoulli}(p)$.\nEntonces $E[X] = p$.",
};

const entries: Entry[] = [
	{ kind: "user", text: "¿Por qué $\\operatorname{Var}(X) = p(1-p)$?", anchor },
	{
		kind: "answer",
		reason: "completed",
		parts: [
			{
				kind: "thinking",
				text: "Uso $E[X^2]$.\n\n> [!tool] no es una herramienta",
			},
			{
				kind: "tool",
				name: "Read",
				input: '{"file_path":"probabilidad/materials/apunte (1).pdf"}',
				result: { ok: true, summary: "PDF file read: 12 pages" },
			},
			{
				kind: "tool",
				name: "mcp__study__calc",
				input: '{"expr":"0.3 * (1 - 0.3)"}',
				result: { ok: false, summary: "" },
			},
			{ kind: "tool", name: "Grep", input: "" },
			{
				kind: "text",
				text: [
					"Porque $E[X^2] = p$:",
					"",
					"$$",
					"\\begin{aligned}",
					"\\operatorname{Var}(X) &= E[X^2] - E[X]^2 \\\\",
					"&= p - p^2 = p(1-p).",
					"\\end{aligned}",
					"$$",
					"",
					"## Paso 2",
					"",
					"> [!note] un callout de Claude",
					"",
					"```md",
					"## Tú",
					"## Claude",
					"\\## Nota",
					"> [!tool] Read",
					"> [!thinking]- Pensó",
					"```",
				].join("\n"),
			},
			{ kind: "thinking", text: "Y ahora el resultado." },
			{ kind: "text", text: "Listo." },
		],
	},
	{
		kind: "note",
		anchor: { ...anchor, page: 4, text: "la varianza es máxima en $p = 1/2$" },
		text: "Repasar para el parcial.\n\nCon $p=1/2$ da $1/4$.",
	},
	{ kind: "note", anchor: { path: "logica/notes/a.md", page: 1, text: "" } },
	{ kind: "user", text: "¿Y para una binomial?" },
	{
		kind: "answer",
		reason: "interrupted",
		parts: [{ kind: "text", text: "Para $X \\sim B(n, p)$ hay" }],
	},
	{ kind: "user", text: "Seguí" },
	{ kind: "answer", reason: "error", parts: [] },
	{ kind: "user", text: "Sin respuesta todavía" },
];

test("a transcript round-trips: anchors, notes, interrupted turns and math", () => {
	const md = format(meta, entries);
	expect(parse(md)).toEqual({ meta, entries });
	// And again from the parsed copy, byte for byte.
	expect(format(meta, parse(md).entries)).toBe(md);
});

test("it reads cleanly as plain Markdown", () => {
	const md = format(meta, entries);
	expect(md).toStartWith(`---
id: 3f2a9c1e-0000-4000-8000-000000000001
course: probabilidad
title: "Varianza: Bernoulli y binomial"
created: 2026-11-22T18:30:00.000Z
mode: explain
`);
	// A hash that YAML would read as a number stays a string.
	expect(md).toContain('sdk_body_hash: "0e51"');
	expect(md).toContain(
		"## Tú\n\n> [apunte (1).pdf, p. 3](../../probabilidad/materials/apunte%20%281%29.pdf#page=3)\n> Sea $X",
	);
	expect(md).toContain("## Claude *(interrumpida)*\n\nPara $X");
	expect(md).toContain(
		"## Nota\n\n> [!note] [apunte (1).pdf, p. 4](../../probabilidad/materials/apunte%20%281%29.pdf#page=4)\n> > la varianza",
	);
	// Lines in an answer that look like our headings are escaped.
	expect(md).toContain(
		"```md\n\\## Tú\n\\## Claude\n\\\\## Nota\n\\> [!tool] Read\n\\> [!thinking]- Pensó\n```",
	);
	// Thinking and tool calls are callouts, in the order they streamed.
	expect(md).toContain(
		[
			"## Claude",
			"",
			"> [!thinking]- Pensó",
			"> Uso $E[X^2]$.",
			">",
			"> > [!tool] no es una herramienta",
			"",
			"> [!tool] Read",
			'> {"file_path":"probabilidad/materials/apunte (1).pdf"}',
			"> ✓ PDF file read: 12 pages",
			"",
			"> [!tool] mcp__study__calc",
			'> {"expr":"0.3 * (1 - 0.3)"}',
			"> ✗",
			"",
			"> [!tool] Grep",
			">",
			"",
			"Porque",
		].join("\n"),
	);
	expect(md).toContain("\n## Paso 2\n");
});

test("an answer from before thinking and tools were kept reads as one text part", () => {
	const md = `${format(meta, [])}\n## Tú\n\nhola\n\n## Claude\n\nUno.\n\n> cita\n\nDos.\n`;
	expect(parse(md).entries[1]).toEqual({
		kind: "answer",
		reason: "completed",
		parts: [{ kind: "text", text: "Uno.\n\n> cita\n\nDos." }],
	});
});

test("streamed blocks become parts: text joined, empty thinking dropped, tools on one line", () => {
	expect(
		partsOf([
			{ kind: "thinking", text: "  " },
			{ kind: "text", text: "Uno." },
			{ kind: "text", text: "Dos. " },
			{
				kind: "tool",
				name: "Read",
				text: '{"file_path": "a.pdf",\n "pages": "3"}',
				result: { ok: true, summary: " línea\nsuelta " },
			},
			{ kind: "tool", name: "Grep", text: '{"pattern": "Var' },
		]),
	).toEqual([
		{ kind: "text", text: "Uno.\n\nDos." },
		{
			kind: "tool",
			name: "Read",
			input: '{"file_path":"a.pdf","pages":"3"}',
			result: { ok: true, summary: "línea suelta" },
		},
		{ kind: "tool", name: "Grep", input: '{"pattern": "Var' },
	]);
});

test("keys added by hand survive, and odd values are read as text", () => {
	const md = format(meta, []).replace(
		"mode: explain",
		"mode: explain\ntags: parcial\ntitle2: 12",
	);
	const { meta: read } = split(md);
	expect(read.tags).toBe("parcial");
	expect(read.title2).toBe("12");
	expect(format(read, [])).toContain("tags: parcial");
});

test("a hand-edited body parses, and its hash changes", () => {
	const md = format(meta, entries.slice(0, 2));
	const { body } = split(md);
	const edited = `${md.replace("Porque", "Porque, como vimos,")}\nUna línea suelta sin salto`;
	const parsed = parse(edited);
	expect(parsed.entries[1]).toMatchObject({ kind: "answer" });
	const answer = parsed.entries[1] as Extract<Entry, { kind: "answer" }>;
	expect(answer.parts.find((p) => p.kind === "text")?.text).toStartWith(
		"Porque, como vimos,",
	);
	expect(bodyHash(split(edited).body)).not.toBe(bodyHash(body));
	expect(bodyHash(body)).toBe(
		bodyHash(split(format(meta, entries.slice(0, 2))).body),
	);
});

test("a title change keeps the body hash", () => {
	const a = split(format(meta, entries));
	const b = split(format({ ...meta, title: "Otro" }, entries));
	expect(bodyHash(a.body)).toBe(bodyHash(b.body));
});

test("a file with no front matter is refused", () => {
	expect(() => parse("## Tú\n\nhola\n")).toThrow("front matter");
});
