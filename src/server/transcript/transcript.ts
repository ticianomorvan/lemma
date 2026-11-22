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
 * - Session files always sit at `<course>/sessions/<file>.md`, so anchor links
 *   are `../../<root-relative path>` and open in an editor.
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

export type Entry =
	| { kind: "user"; text: string; anchor?: Anchor }
	| { kind: "answer"; text: string; reason: TurnEndReason }
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
const LINK = "../../";

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
			const quote = entry.anchor ? `${anchorQuote(entry.anchor)}\n\n` : "";
			return section(HEADINGS.user, quote + escapeHeadings(entry.text.trim()));
		}
		case "answer":
			return section(HEADINGS[entry.reason], escapeHeadings(entry.text.trim()));
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

function parseEntry(heading: string, lines: string[]): Entry | null {
	switch (heading) {
		case HEADINGS.user: {
			const anchor = readAnchor(lines);
			const text = unescapeHeadings(trimLines(lines.slice(anchor?.lines ?? 0)));
			return anchor
				? { kind: "user", text, anchor: anchor.anchor }
				: { kind: "user", text };
		}
		case HEADINGS.completed:
			return {
				kind: "answer",
				text: unescapeHeadings(lines),
				reason: "completed",
			};
		case HEADINGS.interrupted:
			return {
				kind: "answer",
				text: unescapeHeadings(lines),
				reason: "interrupted",
			};
		case HEADINGS.error:
			return { kind: "answer", text: unescapeHeadings(lines), reason: "error" };
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
	const href = (LINK + path)
		.split("/")
		.map((part) =>
			encodeURIComponent(part).replace(/[()]/g, (c) =>
				c === "(" ? "%28" : "%29",
			),
		)
		.join("/");
	return `[${name.replace(/[[\]]/g, "\\$&")}, p. ${page}](${href}#page=${page})`;
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

/** `\`-prefixes every line that, stripped of leading `\`s, is a heading line. */
function escapeHeadings(text: string) {
	return text
		.split("\n")
		.map((l) => (HEADING_LINES.has(l.replace(/^\\+/, "")) ? `\\${l}` : l))
		.join("\n");
}

function unescapeHeadings(lines: string[]) {
	return lines
		.map((l) =>
			l.startsWith("\\") && HEADING_LINES.has(l.replace(/^\\+/, ""))
				? l.slice(1)
				: l,
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
