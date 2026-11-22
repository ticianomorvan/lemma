/**
 * Prepares model output for remark-math, on every streamed chunk:
 * - `\(…\)` and `\[…\]` become `$…$` and `$$…$$`;
 * - a `$` that opens a currency amount (`$30`) is escaped;
 * - display math whose closing delimiter hasn't arrived stays raw source in a
 *   `math-pending` block, so KaTeX never sees half a formula and nothing
 *   flashes red. That covers text still streaming and an answer interrupted
 *   mid-formula alike.
 *
 * The first two are assistant-ui's transforms (see `vendor/`), which skip code
 * spans, fences and HTML. An unclosed inline `$x` needs nothing: remark-math
 * only makes math from a closed pair, so it already stays text.
 */
import {
	escapeCurrencyDollars,
	normalizeMathDelimiters,
} from "./vendor/assistant-ui-preprocess.ts";

/** The fence language of a display formula still streaming in. */
export const PENDING_MATH = "math-pending";

export function normalizeMath(text: string): string {
	return holdOpenMath(escapeCurrencyDollars(normalizeMathDelimiters(text)));
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
	let fence = "";
	let lineStart = true;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (lineStart) {
			lineStart = false;
			const line = /^[ \t>]*(`{3,}|~{3,})/.exec(text.slice(i, i + 64));
			if (line?.[1]) {
				const run = line[1];
				if (!fence) fence = run;
				else if (run[0] === fence[0] && run.length >= fence.length) fence = "";
				i = text.indexOf("\n", i);
				if (i === -1) break;
				lineStart = true;
				continue;
			}
		}
		if (c === "\n") {
			lineStart = true;
			continue;
		}
		if (fence) continue;
		if (c === "\\") {
			const next = text[i + 1];
			if (display === -1 && bracket === -1 && (next === "[" || next === "(")) {
				bracket = i;
				closer = next === "[" ? "\\]" : "\\)";
			} else if (bracket !== -1 && `\\${next}` === closer) {
				bracket = -1;
			}
			i++;
			continue;
		}
		if (c === "`" && display === -1 && bracket === -1) {
			const run = longestRunAt(text, i, "`");
			const end = text.indexOf("`".repeat(run), i + run);
			if (end !== -1) {
				i = end + run - 1;
				continue;
			}
			i += run - 1;
			continue;
		}
		if (c === "$" && text[i + 1] === "$" && bracket === -1) {
			display = display === -1 ? i : -1;
			i++;
		}
	}
	if (fence) return -1;
	return display !== -1 ? display : bracket;
}

function longestRunAt(text: string, at: number, char: string) {
	let n = 0;
	while (text[at + n] === char) n++;
	return n;
}

function longestRun(text: string, char: string) {
	let best = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] !== char) continue;
		const n = longestRunAt(text, i, char);
		best = Math.max(best, n);
		i += n;
	}
	return best;
}
