/**
 * "Export session": a transcript becomes a Typst document, written to
 * `<course>/exports/<session file>.typ` and compiled to a PDF beside it. See
 * docs/architecture.md → Typst.
 *
 * - Text goes through the same Markdown parser as the client's (remark, GFM,
 *   math) and comes out as Typst markup, every special character escaped, so
 *   nothing a student or Claude wrote runs as Typst code.
 * - Math stays LaTeX: `@preview/mitex` (shipped in `assets/packages`)
 *   renders it, so `align`, `cases` and `pmatrix` survive as written.
 * - Diagram blocks: a `typst` block goes in as Typst, evaluated from a
 *   string in its own scope, once it compiles alone; a `dot` block goes in as the SVG Graphviz
 *   draws for it. The other kinds (and a block that fails) keep their source,
 *   in a code block with a line saying so.
 * - Photos are images, by their path relative to the export.
 * - Thinking summaries and tool calls stay out: the export is for reading.
 */
import { dirname, posix } from "node:path";
import type {
	Blockquote,
	Code,
	List,
	Nodes,
	Root,
	Table,
	Text as TextNode,
} from "mdast";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { isBlockKindName } from "../../shared/blocks.ts";
import { normalizeMath } from "../../shared/normalize-math.ts";
import type { Anchor } from "../../shared/protocol.ts";
import { MAX_TYPST_SOURCE } from "../../shared/typst.ts";
import type { Folder } from "../folder/folder.ts";
import { exportsDir } from "../folder/layout.ts";
import {
	type Entry,
	parse,
	type TranscriptMeta,
} from "../transcript/transcript.ts";
import { MITEX_IMPORT, type Typst } from "./typst.ts";

/** Draws a diagram block as Typst, or null to keep its source. */
export type DrawBlock = (
	kind: string,
	source: string,
) => Promise<string | null>;

const answerParser = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkMath, { singleDollarTextMath: true });
// Questions are typed in a box where a line break is a line break.
const questionParser = answerParser().use(remarkBreaks);

const KIND_LABELS: Record<string, string> = {
	dot: "grafo",
	proof: "deducción",
	fitch: "prueba de Fitch",
	plot: "gráfico",
	"vega-lite": "gráfico de datos",
	mermaid: "diagrama",
	typst: "bloque Typst",
};

/**
 * The document for one transcript. `typPath` is where it will be written
 * (root-relative), so photos can be linked relative to it.
 */
export async function toTypst(
	meta: TranscriptMeta,
	entries: Entry[],
	{ typPath, draw }: { typPath: string; draw: DrawBlock },
): Promise<string> {
	const out: string[] = [
		`#import "${MITEX_IMPORT}": mitex, mi`,
		"",
		`#set document(title: ${str(meta.title || "Sesión")})`,
		'#set page(paper: "a4", margin: 2cm, numbering: "1")',
		'#set text(lang: "es", size: 11pt)',
		"#set par(justify: true)",
		"#show raw.where(block: true): block.with(fill: luma(246), inset: 8pt, radius: 4pt, width: 100%)",
		"#let pregunta(body) = block(fill: luma(240), inset: 10pt, radius: 6pt, width: 100%, body)",
		"#let fuente(body) = text(size: 9pt, fill: luma(110), body)",
		"",
		`= ${text(meta.title || "Sesión")}`,
		"",
		`#fuente[${text(`${meta.course} · ${meta.created.slice(0, 10)}`)}]`,
		"",
	];
	const here = dirname(typPath);
	for (const entry of entries) {
		if (entry.kind === "user") {
			const body: string[] = [];
			if (entry.anchor) body.push(quote(entry.anchor), "");
			body.push(await markup(questionParser, entry.text, draw));
			for (const photo of entry.attachments ?? []) {
				body.push(
					"",
					`#image(${str(posix.relative(here, photo))}, width: 60%)`,
				);
			}
			out.push(`#pregunta[\n${body.join("\n").trim()}\n]`, "");
		} else if (entry.kind === "answer") {
			const parts = entry.parts.filter((p) => p.kind === "text");
			out.push(
				await markup(answerParser, parts.map((p) => p.text).join("\n\n"), draw),
			);
			if (entry.reason !== "completed") {
				out.push(
					"",
					`#fuente[${entry.reason === "interrupted" ? "(respuesta interrumpida)" : "(la respuesta terminó con un error)"}]`,
				);
			}
			out.push("");
		} else {
			out.push(
				"#block(stroke: (left: 2pt + luma(180)), inset: (left: 10pt, y: 4pt))[",
				`#fuente[Nota · ${text(source(entry.anchor))}]`,
				"",
				`_${text(oneLine(entry.anchor.text))}_`,
				...(entry.text ? ["", text(entry.text)] : []),
				"]",
				"",
			);
		}
	}
	return `${out.join("\n").trimEnd()}\n`;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

const source = (a: Anchor) =>
	`${a.path.split("/").pop() ?? a.path}, p. ${a.page}`;

function quote(anchor: Anchor) {
	return [
		`#fuente[${text(source(anchor))}]`,
		"",
		`#quote(block: true)[${text(oneLine(anchor.text))}]`,
	].join("\n");
}

async function markup(
	parser: typeof answerParser | typeof questionParser,
	md: string,
	draw: DrawBlock,
): Promise<string> {
	const tree = parser.runSync(parser.parse(normalizeMath(md))) as Root;
	return (await blocks(tree.children, draw)).trim();
}

async function blocks(nodes: Nodes[], draw: DrawBlock): Promise<string> {
	const out: string[] = [];
	for (const node of nodes) out.push(await block(node, draw));
	return out.filter((b) => b !== "").join("\n\n");
}

async function block(node: Nodes, draw: DrawBlock): Promise<string> {
	switch (node.type) {
		case "paragraph":
			return startLine(inline(node.children));
		case "heading":
			// The session title is level 1; an answer's headings sit below it.
			return `${"=".repeat(Math.min(node.depth + 1, 6))} ${inline(node.children)}`;
		case "math":
			return `#align(center, mitex(${str(latex(node.value))}))`;
		case "code":
			return code(node, draw);
		case "list":
			return list(node, draw);
		case "blockquote":
			return blockquote(node, draw);
		case "table":
			return table(node);
		case "thematicBreak":
			return "#line(length: 100%, stroke: 0.5pt + luma(180))";
		case "html":
			// An HTML comment (a fixture marker, say) or tag: not shown.
			return "";
		default:
			return "children" in node ? blocks(node.children as Nodes[], draw) : "";
	}
}

async function code(node: Code, draw: DrawBlock): Promise<string> {
	const lang = node.lang ?? "";
	if (isBlockKindName(lang)) {
		const drawn = await draw(lang, node.value).catch(() => null);
		if (drawn !== null) return drawn;
		return `${`#fuente[${text(`(${KIND_LABELS[lang] ?? lang}: se muestra su fuente)`)}]`}\n\n${raw(node.value, lang === "typst" ? "typ" : lang)}`;
	}
	return raw(node.value, lang);
}

async function list(node: List, draw: DrawBlock): Promise<string> {
	const items: string[] = [];
	for (const item of node.children) {
		const body = await blocks(item.children as Nodes[], draw);
		const mark =
			item.checked === true ? "☑ " : item.checked === false ? "☐ " : "";
		items.push(`${node.ordered ? "+" : "-"} ${indent(mark + body)}`);
	}
	const start = node.ordered && node.start != null && node.start !== 1;
	return start
		? // Scoped, so later lists start at 1 again.
			`#[\n#set enum(start: ${node.start})\n${items.join("\n")}\n]`
		: items.join("\n");
}

async function blockquote(node: Blockquote, draw: DrawBlock): Promise<string> {
	return `#quote(block: true)[\n${await blocks(node.children as Nodes[], draw)}\n]`;
}

function table(node: Table): string {
	const columns = node.children[0]?.children.length ?? 1;
	// GFM rows may be short or long: each takes exactly `columns` cells.
	const cells = node.children.flatMap((row, i) =>
		Array.from({ length: columns }, (_, c) => {
			const cell = row.children[c];
			const body = cell ? inline(cell.children) : "";
			return i === 0 ? `[*${body}*]` : `[${body}]`;
		}),
	);
	return `#table(columns: ${columns}, inset: 6pt, stroke: 0.5pt + luma(170),\n  ${cells.join(", ")},\n)`;
}

/**
 * Inline content. Every `#expr` it emits ends in `;`, so text that follows
 * (`**Nota**(opcional)`, `$f$(x)`) can't read as a call or field access.
 */
function inline(nodes: Nodes[]): string {
	return nodes.map(inlineNode).join("");
}

function inlineNode(node: Nodes): string {
	switch (node.type) {
		case "text":
			return text((node as TextNode).value.replace(/\s*\n\s*/g, " "));
		case "emphasis":
			return `#emph[${inline(node.children)}];`;
		case "strong":
			return `#strong[${inline(node.children)}];`;
		case "delete":
			return `#strike[${inline(node.children)}];`;
		case "inlineCode":
			return `#raw(${str(node.value)});`;
		case "inlineMath":
			return `#mi(${str(latex(node.value))});`;
		case "break":
			return " \\\n";
		case "link":
			return /^https?:\/\//i.test(node.url)
				? `#link(${str(node.url)})[${inline(node.children)}];`
				: inline(node.children);
		case "image":
			// Images in answers point anywhere; keep their description.
			return text(node.alt ?? "");
		case "html":
			return "";
		default:
			return "children" in node ? inline(node.children as Nodes[]) : "";
	}
}

/** Typst markup that shows `s` as plain text. */
export function text(s: string): string {
	return s.replace(/[\\#$*_`<>@[\]~/=+-]/g, "\\$&");
}

/** A Typst string literal. */
export function str(s: string): string {
	return `"${s.replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}

/** A raw (code) block whose fence no backtick run inside can close. */
function raw(body: string, lang: string): string {
	const longest = Math.max(
		2,
		...[...body.matchAll(/`+/g)].map((m) => m[0].length),
	);
	const fence = "`".repeat(longest + 1);
	const tag = /^[\w+-]+$/.test(lang) ? lang : "";
	return `${fence}${tag}\n${body}\n${fence}`;
}

/** A decimal comma `0{,}5` is LaTeX's no-space comma; mitex needs it spelled out. */
function latex(tex: string): string {
	return tex.replace(/\{,\}/g, "\\mathord{,}").trim();
}

/** `1.` at the start of a paragraph would start a numbered list. */
function startLine(s: string): string {
	return s.replace(/^(\d+)\./, "$1\\.");
}

/** Continuation lines of a list item, indented under its marker. */
function indent(s: string): string {
	return s.replace(/\n/g, "\n  ");
}

// ── Writing the files ───────────────────────────────────────────────────────

/** The export's path for a transcript at `<course>/sessions/<file>.md`. */
export function exportPath(transcript: string, course: string): string {
	const name = posix.basename(transcript).replace(/\.md$/, "");
	return `${exportsDir(course)}/${name}.typ`;
}

/**
 * Writes the session's `.typ` and compiles its PDF. The compile reads only
 * the `.typ` and the photos it shows (and mitex), however the blocks inside
 * it were written.
 */
export async function exportSession(
	folder: Folder,
	typst: Typst,
	transcript: string,
): Promise<{ typ: string; pdf: string | null; error?: string }> {
	const { meta, entries } = parse(folder.read(transcript));
	const typ = exportPath(transcript, meta.course);
	const doc = await toTypst(meta, entries, {
		typPath: typ,
		draw: (kind, src) => drawBlock(typst, kind, src),
	});
	folder.writeAtomic(typ, doc);
	const photos = entries.flatMap((e) =>
		e.kind === "user" ? (e.attachments ?? []) : [],
	);
	const compiled = await typst.exportPdf(folder.root, typ, [typ, ...photos]);
	const pdf = typ.replace(/\.typ$/, ".pdf");
	if (!compiled.ok) return { typ, pdf: null, error: compiled.error };
	folder.writeAtomic(pdf, compiled.value);
	return { typ, pdf };
}

/**
 * A `typst` block goes in as itself when it compiles alone inside the scope
 * it will have (evaluated from a string, so its rules stay inside); a `dot` block as the
 * SVG Graphviz draws. Anything else keeps its source.
 */
export async function drawBlock(
	typst: Typst,
	kind: string,
	src: string,
): Promise<string | null> {
	if (kind === "typst") {
		// Evaluated from a string, so no `]` in the source can close its scope
		// and leak set or show rules into the rest of the export.
		const scoped = `#eval(${str(src)}, mode: "markup")`;
		return (await typst.svg(scoped)).ok ? scoped : null;
	}
	if (kind === "dot") {
		const svg = await dotSvg(src);
		if (!svg) return null;
		const image = `#align(center, image(bytes(${str(svg)}), format: "svg", width: auto))`;
		// Typst must be able to load the SVG, or the whole PDF would fail.
		return (await typst.svg(image)).ok ? image : null;
	}
	return null;
}

let viz: Promise<import("@viz-js/viz").Viz> | undefined;

async function dotSvg(src: string): Promise<string | null> {
	if (src.length > MAX_TYPST_SOURCE) return null;
	viz ??= import("@viz-js/viz").then((m) => m.instance());
	const result = (await viz).render(src, {
		format: "svg",
		graphAttributes: { bgcolor: "transparent" },
	});
	return result.status === "success" ? (result.output ?? null) : null;
}
