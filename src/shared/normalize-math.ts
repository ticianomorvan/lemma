/**
 * Prepares model output for remark-math, on every streamed chunk:
 * - `\(…\)` and `\[…\]` become `$…$` and `$$…$$`;
 * - a `$` that opens a currency amount (`$30`) is escaped;
 * - display math whose closing delimiter hasn't arrived stays raw source in a
 *   `math-pending` block, so KaTeX never sees half a formula and nothing
 *   flashes red. That covers text still streaming and an answer interrupted
 *   mid-formula alike.
 *
 * None of it touches code fences or code spans. The system prompt already asks
 * for `$…$` and `$$…$$` only, so the first two are a safety net. An unclosed
 * inline `$x` needs nothing: remark-math only makes math from a closed pair.
 */

/** The fence language of a display formula still streaming in. */
export const PENDING_MATH = "math-pending";

export function normalizeMath(text: string): string {
	let out = "";
	for (const piece of pieces(text)) {
		const slice = text.slice(piece.from, piece.to);
		out += piece.code ? slice : escapeCurrency(rewriteBrackets(slice));
	}
	return holdOpenMath(out);
}

type Piece = { code: boolean; from: number; to: number };

/**
 * A code fence, open or closed. The closing line repeats the opening
 * character at least as many times; an unclosed fence runs to the end.
 */
const FENCE =
	/^[ \t>]*(([`~])\2{2,})[^\n]*(?:\n(?:[\s\S]*?\n)?[ \t>]*\1\2*[ \t]*(?=\n|(?![\s\S]))|[\s\S]*)/gm;
/** A code span: a backtick run closed by a run of the same length. */
const CODE_SPAN = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;

/** Splits text into code (fences and spans) and the prose between. */
function pieces(text: string): Piece[] {
	const out: Piece[] = [];
	const prose = (from: number, to: number) => {
		let at = from;
		for (const m of text.slice(from, to).matchAll(CODE_SPAN)) {
			const start = from + m.index;
			out.push({ code: false, from: at, to: start });
			at = start + m[0].length;
			out.push({ code: true, from: start, to: at });
		}
		out.push({ code: false, from: at, to });
	};
	let at = 0;
	for (const m of text.matchAll(FENCE)) {
		prose(at, m.index);
		at = m.index + m[0].length;
		out.push({ code: true, from: m.index, to: at });
	}
	prose(at, text.length);
	return out.filter((p) => p.to > p.from);
}

/** `\[…\]` → `$$…$$` and `\(…\)` → `$…$`; `\\[` (a LaTeX line break) is left. */
function rewriteBrackets(prose: string): string {
	return prose
		.replace(/(?<!\\)\\\[([\s\S]*?)\\\]/g, (_, m) => `$$${m}$$`)
		.replace(/(?<!\\)\\\(([^\n]*?)\\\)/g, (_, m) => `$${m}$`);
}

/**
 * Escapes a `$` before a digit unless it opens inline math. Deciding on the
 * pair, not the digit, keeps `$0$` and `$5x = 10$` math and `$5 y $7` money.
 */
function escapeCurrency(prose: string): string {
	let out = "";
	for (let i = 0; i < prose.length; i++) {
		const c = prose[i];
		if (c === "\\") {
			out += prose.slice(i, i + 2);
			i++;
		} else if (c !== "$") {
			out += c;
		} else if (prose[i + 1] === "$") {
			const run = runAt(prose, i, "$");
			out += "$".repeat(run);
			i += run - 1;
		} else {
			const close = closingDollar(prose, i);
			if (
				close !== -1 &&
				!/\d/.test(prose[close + 1] ?? "") &&
				isMathBody(prose.slice(i + 1, close))
			) {
				out += prose.slice(i, close + 1);
				i = close;
			} else {
				out += /\d/.test(prose[i + 1] ?? "") ? "\\$" : "$";
			}
		}
	}
	return out;
}

function closingDollar(text: string, open: number) {
	for (let i = open + 1; i < text.length; i++) {
		if (text[i] === "\\") i++;
		else if (text[i] === "$") return i;
	}
	return -1;
}

/**
 * Whether the text between two `$` reads as math rather than the prose
 * between two amounts, which ends on a space (`5 y `) or an operator (`5-`).
 */
function isMathBody(body: string) {
	if (body === "" || /\n[ \t]*\n/.test(body)) return false;
	if (/\s$/.test(body) && !/^\s/.test(body)) return false;
	if (/[-+*/=<>,;:([–—−]$/.test(body)) return false;
	if (/\\[a-zA-Z]|[_^{}]/.test(body)) return true;
	return !/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(body);
}

/**
 * Turns an unclosed display formula at the end of the text into a
 * `math-pending` fence holding its source. An unpaired `\[` or `\(` (one
 * the delimiter rewrite left alone because its closer hasn't arrived) is held
 * the same way.
 */
export function holdOpenMath(text: string): string {
	const open = unclosedMath(text);
	// A lone `$` opening the last line is half of a `$$` still on its way.
	if (open === -1) return text.replace(/(^|\n)[ \t]*\$$/, "$1");
	const opener = 2; // `$$`, `\[` and `\(` are all two characters
	const head = text.slice(0, open).replace(/[ \t]+$/, "");
	const body = text.slice(open + opener).replace(/^\s*\n/, "");
	const fence = "~".repeat(Math.max(3, longestRun(body, "~") + 1));
	const gap =
		head === "" || head.endsWith("\n\n")
			? ""
			: head.endsWith("\n")
				? "\n"
				: "\n\n";
	return `${head}${gap}${fence}${PENDING_MATH}\n${body}\n${fence}\n`;
}

/**
 * The index of a display delimiter (`$$`, `\[`, `\(`) that is never closed,
 * outside code; -1 if every one is closed.
 */
function unclosedMath(text: string): number {
	let display = -1; // index of an open `$$`
	let bracket = -1; // index of an open `\[` or `\(`
	let closer = "";
	for (const piece of pieces(text)) {
		if (piece.code) continue;
		for (let i = piece.from; i < piece.to; i++) {
			const pair = text.slice(i, i + 2);
			if (text[i] === "\\") {
				if (display === -1 && bracket === -1 && /^\\[[(]$/.test(pair)) {
					bracket = i;
					closer = pair === "\\[" ? "\\]" : "\\)";
				} else if (bracket !== -1 && pair === closer) {
					bracket = -1;
				}
				i++;
			} else if (pair === "$$" && bracket === -1) {
				display = display === -1 ? i : -1;
				i++;
			}
		}
	}
	return display !== -1 ? display : bracket;
}

function runAt(text: string, at: number, char: string) {
	let n = 0;
	while (text[at + n] === char) n++;
	return n;
}

function longestRun(text: string, char: string) {
	let best = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== char) continue;
		const n = runAt(text, i, char);
		best = Math.max(best, n);
		i += n;
	}
	return best;
}
