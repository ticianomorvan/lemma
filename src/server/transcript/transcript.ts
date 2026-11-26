/**
 * A session's Markdown transcript ⇄ typed entries. The file is the truth (see
 * docs/architecture.md → Sessions and the source of truth), so it has to read
 * cleanly in any editor and parse back to exactly what was written:
 *
 * ```md
 * ---
 * id: 3f2a…
 * course: probabilidad
 * title: Varianza de una Bernoulli
 * …
 * ---
 *
 * ## Tú
 *
 * > [apunte.pdf, p. 3](../../probabilidad/materials/apunte.pdf#page=3)
 * > La varianza de una Bernoulli es…
 *
 * ¿Por qué da $p(1-p)$?
 *
 * ## Claude
 *
 * > [!thinking]- Pensó
 * > Calculo la esperanza de X².
 *
 * > [!tool] mcp__study__calc
 * > {"expr":"0.3 * (1 - 0.3)"}
 * > ✓ 0.21
 *
 * Porque …
 *
 * ## Nota
 *
 * > [!note] [apunte.pdf, p. 4](../../probabilidad/materials/apunte.pdf#page=4)
 * > > el texto marcado
 * >
 * > lo que anoté
 * ```
 *
 * - Entries are separated by the exact heading lines in `HEADINGS`. A line in
 *   an entry that would read as one gets a leading `\` (which Markdown shows as
 *   the literal text), and parsing removes it again.
 * - An answer is a list of parts in the order they streamed: text, a thinking
 *   summary (a folded `> [!thinking]-` callout) and tool calls (a `> [!tool]`
 *   callout with the tool's name, its input as one line of JSON, and `✓` or
 *   `✗` with the first line of its result). Answer lines that would read as
 *   either callout's first line are escaped like headings.
 * - Session files always sit at `<course>/sessions/<file>.md`, so anchor links
 *   are `../../<root-relative path>` and open in an editor.
 * - A question's photos close it, one Markdown image per line:
 *   `![Foto](../../<course>/sessions/<file>/001-photo.jpg)`.
 * - Entry text is trimmed when written.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Anchor, TurnEndReason } from "../../shared/protocol.ts";
import type { Folder } from "../folder/folder.ts";

/** Keys a person adds by hand are kept when the header is rewritten. */
export const TranscriptMeta = z.looseObject({
	id: z.string().min(1),
	course: z.string().min(1),
	title: z.string(),
	created: z.string(),
	mode: z.string().optional(),
	/** The SDK session the last finished turn ran in. */
	sdk_session_id: z.string().optional(),
	/** `bodyHash` of the body when that turn ended; a different body means an edit. */
	sdk_body_hash: z.string().optional(),
});
export type TranscriptMeta = z.infer<typeof TranscriptMeta>;

/**
 * One part of an answer. A tool's `name`, `input` and `summary` are single
 * lines (`partsOf` makes them so).
 */
export type Part =
	| { kind: "text"; text: string }
	| { kind: "thinking"; text: string }
	| {
			kind: "tool";
			name: string;
			input: string;
			result?: { ok: boolean; summary: string };
	  };

export type Entry =
	| {
			kind: "user";
			text: string;
			anchor?: Anchor;
			/** Root-relative paths of the photos it sent. */
			attachments?: string[];
	  }
	| { kind: "answer"; parts: Part[]; reason: TurnEndReason }
	| { kind: "note"; anchor: Anchor; text?: string };

export type Transcript = { meta: TranscriptMeta; body: string };

const HEADINGS = {
	user: "## Tú",
	completed: "## Claude",
	interrupted: "## Claude *(interrumpida)*",
	error: "## Claude *(error)*",
	note: "## Nota",
} as const;
const HEADING_LINES = new Set<string>(Object.values(HEADINGS));
const THINKING = "> [!thinking]- Pensó";
const TOOL = /^> \[!tool\] (.+)$/;
const RESULT = /^> ([✓✗])(?: (.*))?$/;
/** Lines that start an entry or an answer part, so answer text escapes them. */
const isMarker = (line: string) =>
	HEADING_LINES.has(line) ||
	line.startsWith("> [!thinking]") ||
	line.startsWith("> [!tool]");
const LINK = "../../";
const IMAGE = /^!\[Foto\]\(\.\.\/\.\.\/(\S+)\)$/;

// ── Whole files ─────────────────────────────────────────────────────────────

/** Splits a file into its front matter and body. Throws on a malformed header. */
export function split(md: string): Transcript {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
	if (!match) throw new Error("the transcript has no front matter");
	const raw = Bun.YAML.parse(match[1] ?? "") as Record<string, unknown> | null;
	// Hand-edited values may parse as numbers or dates; they are all text.
	const values = Object.fromEntries(
		Object.entries(raw ?? {})
			.filter(([, v]) => v !== null && v !== undefined && v !== "")
			.map(([k, v]) => [k, v instanceof Date ? v.toISOString() : String(v)]),
	);
	return {
		meta: TranscriptMeta.parse({ title: "", ...values }),
		body: md.slice(match[0].length),
	};
}

export function parse(md: string): { meta: TranscriptMeta; entries: Entry[] } {
	const { meta, body } = split(md);
	return { meta, entries: parseBody(body) };
}

export function format(meta: TranscriptMeta, entries: Entry[] = []): string {
	return join(meta, entries.map(formatEntry).join(""));
}

/** The front matter followed by `body`. */
export function join(meta: TranscriptMeta, body: string): string {
	const fields = Object.fromEntries(
		Object.entries(TranscriptMeta.parse(meta)).filter(
			([, v]) => v !== undefined,
		),
	);
	return `---\n${Bun.YAML.stringify(fields, null, 2).trimEnd()}\n---\n${body}`;
}

/** What the resume check compares: the body only, so a title change keeps it. */
export function bodyHash(body: string): string {
	return createHash("sha256").update(body).digest("hex").slice(0, 32);
}

// ── Entries ─────────────────────────────────────────────────────────────────

export function formatEntry(entry: Entry): string {
	switch (entry.kind) {
		case "user": {
			const parts = [
				...(entry.anchor ? [anchorQuote(entry.anchor)] : []),
				escapeHeadings(entry.text.trim()),
				(entry.attachments ?? []).map(imageLine).join("\n"),
			];
			return section(HEADINGS.user, parts.filter(Boolean).join("\n\n"));
		}
		case "answer":
			return section(
				HEADINGS[entry.reason],
				entry.parts.map(formatPart).filter(Boolean).join("\n\n"),
			);
		case "note": {
			const inner = [
				`[!note] ${anchorLink(entry.anchor)}`,
				...quoteLines(entry.anchor.text.trim()),
			];
			const text = entry.text?.trim();
			if (text) inner.push("", ...escapeHeadings(text).split("\n"));
			return section(HEADINGS.note, quoteLines(inner.join("\n")).join("\n"));
		}
	}
}

export function parseBody(body: string): Entry[] {
	const entries: Entry[] = [];
	let heading: string | null = null;
	let lines: string[] = [];
	const flush = () => {
		if (heading !== null) {
			const entry = parseEntry(heading, trimLines(lines));
			if (entry) entries.push(entry);
		}
		lines = [];
	};
	for (const line of body.split(/\r?\n/)) {
		if (HEADING_LINES.has(line)) {
			flush();
			heading = line;
		} else {
			lines.push(line);
		}
	}
	flush();
	return entries;
}

function formatPart(part: Part): string {
	switch (part.kind) {
		case "text":
			return escapeHeadings(part.text.trim());
		case "thinking": {
			const text = part.text.trim();
			return text ? [THINKING, ...quoteLines(text)].join("\n") : "";
		}
		case "tool": {
			const lines = [
				`> [!tool] ${part.name}`,
				part.input ? `> ${part.input}` : ">",
			];
			if (part.result) {
				const mark = part.result.ok ? "✓" : "✗";
				const { summary } = part.result;
				lines.push(summary ? `> ${mark} ${summary}` : `> ${mark}`);
			}
			return lines.join("\n");
		}
	}
}

function parseParts(lines: string[]): Part[] {
	const parts: Part[] = [];
	let text: string[] = [];
	const flush = () => {
		const kept = trimLines(text);
		if (kept.length) parts.push({ kind: "text", text: unescapeHeadings(kept) });
		text = [];
	};
	let i = 0;
	const quoted = () => {
		const out: string[] = [];
		while (i < lines.length && lines[i]?.startsWith(">")) {
			out.push(lines[i] ?? "");
			i += 1;
		}
		return out;
	};
	while (i < lines.length) {
		const line = lines[i] ?? "";
		const tool = TOOL.exec(line);
		if (line === THINKING) {
			flush();
			i += 1;
			const body = trimLines(quoted().map(unquote)).join("\n");
			if (body) parts.push({ kind: "thinking", text: body });
		} else if (tool) {
			flush();
			i += 1;
			const [input = ">", result] = quoted();
			const done = result ? RESULT.exec(result) : null;
			parts.push({
				kind: "tool",
				name: tool[1] ?? "",
				input: unquote(input),
				...(done
					? { result: { ok: done[1] === "✓", summary: done[2] ?? "" } }
					: {}),
			});
		} else {
			text.push(line);
			i += 1;
		}
	}
	flush();
	return parts;
}

/**
 * An answer's parts from its streamed blocks: empty thinking is dropped,
 * text blocks in a row are joined, and tool fields become single lines.
 */
export function partsOf(
	blocks: {
		kind: "text" | "thinking" | "tool";
		text: string;
		name?: string;
		result?: { ok: boolean; summary: string };
	}[],
): Part[] {
	const parts: Part[] = [];
	for (const block of blocks) {
		const last = parts.at(-1);
		if (block.kind === "text") {
			const text = block.text.trim();
			if (!text) continue;
			if (last?.kind === "text") last.text = `${last.text}\n\n${text}`;
			else parts.push({ kind: "text", text });
		} else if (block.kind === "thinking") {
			const text = block.text.trim();
			if (text) parts.push({ kind: "thinking", text });
		} else {
			parts.push({
				kind: "tool",
				name: oneLine(block.name ?? "") || "tool",
				input: compactJson(block.text),
				...(block.result
					? {
							result: {
								ok: block.result.ok,
								summary: oneLine(block.result.summary),
							},
						}
					: {}),
			});
		}
	}
	return parts;
}

/** Text on one line, whitespace runs collapsed. */
export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** A tool's input as one line: compact JSON, or the partial text on one line. */
function compactJson(text: string) {
	try {
		return JSON.stringify(JSON.parse(text));
	} catch {
		return oneLine(text);
	}
}

function parseEntry(heading: string, lines: string[]): Entry | null {
	switch (heading) {
		case HEADINGS.user: {
			const anchor = readAnchor(lines);
			const rest = lines.slice(anchor?.lines ?? 0);
			// The photos: the image lines that close the entry.
			let end = rest.length;
			while (end > 0 && IMAGE.test(rest[end - 1] ?? "")) end -= 1;
			const attachments = rest.slice(end).flatMap((line) => {
				const path = IMAGE.exec(line)?.[1];
				try {
					return path ? [decodeURIComponent(path)] : [];
				} catch {
					return [];
				}
			});
			const text = unescapeHeadings(trimLines(rest.slice(0, end)));
			return {
				kind: "user",
				text,
				...(anchor ? { anchor: anchor.anchor } : {}),
				...(attachments.length > 0 ? { attachments } : {}),
			};
		}
		case HEADINGS.completed:
			return { kind: "answer", parts: parseParts(lines), reason: "completed" };
		case HEADINGS.interrupted:
			return {
				kind: "answer",
				parts: parseParts(lines),
				reason: "interrupted",
			};
		case HEADINGS.error:
			return { kind: "answer", parts: parseParts(lines), reason: "error" };
		case HEADINGS.note: {
			const inner = lines.map(unquote);
			const first = /^\[!note\] (.*)$/.exec(inner[0] ?? "");
			const link = first && parseLink(first[1] ?? "");
			if (!link) return null;
			let i = 1;
			const quoted: string[] = [];
			while (i < inner.length && inner[i]?.startsWith(">")) {
				quoted.push(unquote(inner[i] ?? ""));
				i += 1;
			}
			const text = unescapeHeadings(trimLines(inner.slice(i)));
			const anchor = { ...link, text: quoted.join("\n") };
			return text ? { kind: "note", anchor, text } : { kind: "note", anchor };
		}
		default:
			return null;
	}
}

// ── Anchors ─────────────────────────────────────────────────────────────────

function anchorQuote(anchor: Anchor) {
	return quoteLines(
		[
			anchorLink(anchor),
			...(anchor.text.trim() ? [anchor.text.trim()] : []),
		].join("\n"),
	).join("\n");
}

function anchorLink({ path, page }: Anchor) {
	const name = path.split("/").pop() ?? path;
	const href = linkPath(path);
	return `[${name.replace(/[[\]]/g, "\\$&")}, p. ${page}](${href}#page=${page})`;
}

function imageLine(path: string) {
	return `![Foto](${linkPath(path)})`;
}

/** `../../` and the path, each segment encoded (parentheses too, for Markdown). */
function linkPath(path: string) {
	return (LINK + path)
		.split("/")
		.map((part) =>
			encodeURIComponent(part).replace(/[()]/g, (c) =>
				c === "(" ? "%28" : "%29",
			),
		)
		.join("/");
}

function parseLink(text: string): { path: string; page: number } | null {
	const m = /^\[.*\]\((\S+)#page=(\d+)\)$/.exec(text);
	if (!m?.[1]?.startsWith(LINK)) return null;
	try {
		return {
			path: decodeURIComponent(m[1].slice(LINK.length)),
			page: Number(m[2]),
		};
	} catch {
		return null;
	}
}

/** A user entry that opens with an anchor quote: its anchor and line count. */
function readAnchor(lines: string[]) {
	const link = lines[0]?.startsWith("> ") ? parseLink(lines[0].slice(2)) : null;
	if (!link) return null;
	let end = 1;
	while (end < lines.length && lines[end]?.startsWith(">")) end += 1;
	const text = lines.slice(1, end).map(unquote).join("\n");
	return { anchor: { ...link, text }, lines: end };
}

// ── Lines ───────────────────────────────────────────────────────────────────

function section(heading: string, content: string) {
	return content ? `\n${heading}\n\n${content}\n` : `\n${heading}\n`;
}

const quoteLines = (text: string) =>
	text ? text.split("\n").map((l) => (l ? `> ${l}` : ">")) : [];

const unquote = (line: string) =>
	line.startsWith("> ") ? line.slice(2) : line.replace(/^>/, "");

/** Drops blank lines at both ends. */
function trimLines(lines: string[]) {
	let start = 0;
	let end = lines.length;
	while (start < end && !lines[start]?.trim()) start += 1;
	while (end > start && !lines[end - 1]?.trim()) end -= 1;
	return lines.slice(start, end);
}

/**
 * `\`-prefixes every line that, stripped of leading `\`s, is a heading line
 * or the first line of an answer's thinking or tool callout.
 */
function escapeHeadings(text: string) {
	return text
		.split("\n")
		.map((l) => (isMarker(l.replace(/^\\+/, "")) ? `\\${l}` : l))
		.join("\n");
}

function unescapeHeadings(lines: string[]) {
	return lines
		.map((l) =>
			l.startsWith("\\") && isMarker(l.replace(/^\\+/, "")) ? l.slice(1) : l,
		)
		.join("\n");
}

// ── Files in the study folder ───────────────────────────────────────────────

export function read(folder: Folder, path: string): Transcript {
	return split(folder.read(path));
}

export function write(folder: Folder, path: string, transcript: Transcript) {
	folder.writeAtomic(path, join(transcript.meta, transcript.body));
}

/**
 * `transcript` with one more entry at the end. Callers pass the file as it is
 * on disk now, so an edit made while a turn ran survives; earlier entries are
 * never rewritten.
 */
export function appendEntry(transcript: Transcript, entry: Entry): Transcript {
	const { body } = transcript;
	const separator = body === "" || body.endsWith("\n") ? "" : "\n";
	return { ...transcript, body: body + separator + formatEntry(entry) };
}
