/**
 * Session titles. The first message becomes the title (`titleFrom`), with
 * its inline math kept as `$…$`, so the header and the print heading can
 * render it (`titleParts`) and a browser tab or a PDF file name can show it
 * as plain text (`plainTitle`). Titles written before step 12 lost their `$`
 * but kept the TeX inside; `plainTitle` cleans those too.
 */

export type TitlePart = { math: boolean; text: string };

/** Longest title, in characters of its plain form. */
const MAX_TITLE = 60;

/**
 * Splits a title into text and inline math. A `$` opens math only when a
 * closing `$` follows on the line, the math doesn't start or end with a
 * space, and the closing `$` isn't followed by a digit (Pandoc's rule), so
 * "de $5 a $10" stays text. `\$` is a literal dollar.
 */
export function titleParts(title: string): TitlePart[] {
	const parts: TitlePart[] = [];
	let text = "";
	let i = 0;
	while (i < title.length) {
		const c = title[i];
		if (c === "\\" && title[i + 1] === "$") {
			text += "$";
			i += 2;
			continue;
		}
		if (c === "$") {
			const end = closing(title, i + 1);
			if (end > 0) {
				if (text) parts.push({ math: false, text });
				text = "";
				parts.push({ math: true, text: title.slice(i + 1, end) });
				i = end + 1;
				continue;
			}
		}
		text += c;
		i += 1;
	}
	if (text) parts.push({ math: false, text });
	return parts;
}

/** The index of the `$` that closes math opened just before `from`, or -1. */
function closing(s: string, from: number): number {
	if (from >= s.length || /\s/.test(s[from] ?? "")) return -1;
	for (let j = from; j < s.length; j++) {
		if (s[j] === "\\") {
			j += 1;
			continue;
		}
		if (s[j] !== "$") continue;
		if (j === from || /\s/.test(s[j - 1] ?? "") || /\d/.test(s[j + 1] ?? "")) {
			return -1;
		}
		return j;
	}
	return -1;
}

/** A title as plain text: math as Unicode, no `$`, braces or TeX commands. */
export function plainTitle(title: string): string {
	return titleParts(title).map(plainPart).join("").replace(/\s+/g, " ").trim();
}

/** One part of a title as plain text, its spaces kept. */
export const plainPart = (part: TitlePart) => texToPlain(part.text, part.math);

const SYMBOLS: Record<string, string> = {
	to: "→",
	rightarrow: "→",
	Rightarrow: "⇒",
	implies: "⇒",
	leftarrow: "←",
	gets: "←",
	leftrightarrow: "↔",
	Leftrightarrow: "⇔",
	iff: "⇔",
	mapsto: "↦",
	neg: "¬",
	lnot: "¬",
	land: "∧",
	wedge: "∧",
	lor: "∨",
	vee: "∨",
	bot: "⊥",
	top: "⊤",
	vdash: "⊢",
	models: "⊨",
	forall: "∀",
	exists: "∃",
	in: "∈",
	notin: "∉",
	subset: "⊂",
	subseteq: "⊆",
	cup: "∪",
	cap: "∩",
	emptyset: "∅",
	varnothing: "∅",
	setminus: "∖",
	le: "≤",
	leq: "≤",
	ge: "≥",
	geq: "≥",
	ne: "≠",
	neq: "≠",
	approx: "≈",
	equiv: "≡",
	sim: "∼",
	cdot: "·",
	times: "×",
	div: "÷",
	pm: "±",
	infty: "∞",
	sum: "Σ",
	prod: "∏",
	int: "∫",
	partial: "∂",
	sqrt: "√",
	ldots: "…",
	cdots: "⋯",
	dots: "…",
	mid: "|",
	alpha: "α",
	beta: "β",
	gamma: "γ",
	delta: "δ",
	epsilon: "ε",
	varepsilon: "ε",
	theta: "θ",
	lambda: "λ",
	mu: "μ",
	pi: "π",
	rho: "ρ",
	sigma: "σ",
	tau: "τ",
	varphi: "φ",
	phi: "φ",
	chi: "χ",
	psi: "ψ",
	omega: "ω",
	Gamma: "Γ",
	Delta: "Δ",
	Theta: "Θ",
	Lambda: "Λ",
	Sigma: "Σ",
	Phi: "Φ",
	Omega: "Ω",
};

const BLACKBOARD: Record<string, string> = {
	N: "ℕ",
	Z: "ℤ",
	Q: "ℚ",
	R: "ℝ",
	C: "ℂ",
};

const SUPERSCRIPT: Record<string, string> = {
	"0": "⁰",
	"1": "¹",
	"2": "²",
	"3": "³",
	"4": "⁴",
	"5": "⁵",
	"6": "⁶",
	"7": "⁷",
	"8": "⁸",
	"9": "⁹",
	"+": "⁺",
	"-": "⁻",
	n: "ⁿ",
};

/**
 * TeX as plain text. In math, braces are grouping and go; in text (an old
 * title whose `$` were stripped) a lone `{…}` is kept.
 */
const BREAK = "\u0001";
const OPEN = "\u0002";
const CLOSE = "\u0003";

function texToPlain(tex: string, math: boolean): string {
	let s = tex
		// Decimal commas: `1{,}5`.
		.replace(/\{,\}/g, ",")
		// Literal braces survive the grouping braces' removal.
		.replace(/\\\{/g, OPEN)
		.replace(/\\\}/g, CLOSE)
		// A command's output is followed by a break, so `\sim\mathrm{B}` doesn't read as `\simB`.
		.replace(
			/\\(?:operatorname|mathrm|text|textbf|textit|mathbf|mathit|mathsf|mathcal)\s*\{([^{}]*)\}/g,
			`${BREAK}$1`,
		)
		.replace(
			/\\mathbb\s*\{([A-Z])\}/g,
			(_, l: string) => BREAK + (BLACKBOARD[l] ?? l),
		)
		.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, `${BREAK}$1/$2`)
		.replace(/\\sqrt\s*\{([^{}]*)\}/g, `${BREAK}√($1)`)
		.replace(/\\(?:left|right|big|Big|bigg|Bigg)\b\s*/g, "")
		.replace(/\\[,;:!> ]/g, " ")
		.replace(/\\quad|\\qquad/g, " ")
		.replace(/\\([%&#_$])/g, "$1")
		.replace(/\\([A-Za-z]+)\s?/g, (_, name: string) => SYMBOLS[name] ?? name);
	s = s.replace(/\^\{([^{}]*)\}|\^(.)/g, (_, group?: string, one?: string) => {
		const sup = group ?? one ?? "";
		const mapped = [...sup].map((ch) => SUPERSCRIPT[ch]);
		return mapped.every(Boolean) ? mapped.join("") : `^${sup}`;
	});
	s = s.replace(/_\{([^{}]*)\}/g, "_$1");
	if (math) s = s.replace(/[{}]/g, "");
	return s.replaceAll(BREAK, "").replaceAll(OPEN, "{").replaceAll(CLOSE, "}");
}

/**
 * The title a session gets from its first message: the first line, HTML
 * comments gone, `\(…\)` and `$$` written as `$…$`, at most 60 characters of
 * plain text. It never cuts inside a formula: one that doesn't fit is left
 * out, and the title ends in "…".
 */
export function titleFrom(message: string): string {
	const line = message
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\\\(([\s\S]*?)\\\)/g, (_, m: string) => `$${m.trim()}$`)
		.replace(/\$\$/g, "$")
		.replace(/\s+/g, " ")
		.trim();
	if (plainTitle(line).length <= MAX_TITLE) return line;
	let out = "";
	for (const part of titleParts(line)) {
		const piece = part.math
			? `$${part.text}$`
			: part.text.replace(/\$/g, "\\$");
		const room = MAX_TITLE - 1 - plainTitle(out).length;
		const length = texToPlain(part.text, part.math).length;
		if (length <= room) {
			out += piece;
			continue;
		}
		if (!part.math) out += part.text.slice(0, room).replace(/\$/g, "\\$");
		break;
	}
	return `${out.trimEnd()}…`;
}
