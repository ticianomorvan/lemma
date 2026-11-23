/**
 * The safe expression language of `plot` blocks: numbers, `x`, the constants
 * `pi` and `e`, `+ - * / ^`, unary minus, parentheses and an allow-list of
 * functions. It parses to a tree and evaluates that tree; nothing Claude wrote
 * ever reaches `eval` or `Function`.
 */

import chi2pdf from "@stdlib/stats-base-dists-chisquare-pdf";
import normalCdf from "@stdlib/stats-base-dists-normal-cdf";
import normalPdf from "@stdlib/stats-base-dists-normal-pdf";
import tpdf from "@stdlib/stats-base-dists-t-pdf";

export type Fn = (x: number) => number;

type Node =
	| { t: "num"; v: number }
	| { t: "var" }
	| { t: "neg"; a: Node }
	| { t: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Node; b: Node }
	| { t: "call"; f: (...args: number[]) => number; args: Node[] };

// The same stdlib functions `calc` uses (server/tools/calc), so a plot and a
// computed answer agree to the last digit.
const normpdf = (x: number, mu = 0, sigma = 1) => normalPdf(x, mu, sigma);
const normcdf = (x: number, mu = 0, sigma = 1) => normalCdf(x, mu, sigma);
const erf = (x: number) => 2 * normalCdf(x * Math.SQRT2, 0, 1) - 1;
const exppdf = (x: number, lambda: number) =>
	x < 0 ? 0 : lambda * Math.exp(-lambda * x);
const unifpdf = (x: number, a: number, b: number) =>
	x < a || x > b ? 0 : 1 / (b - a);

/** Name → [function, min args, max args]. */
const FUNCTIONS: Record<string, [(...a: number[]) => number, number, number]> =
	{
		sin: [Math.sin, 1, 1],
		cos: [Math.cos, 1, 1],
		tan: [Math.tan, 1, 1],
		asin: [Math.asin, 1, 1],
		acos: [Math.acos, 1, 1],
		atan: [Math.atan, 1, 1],
		sinh: [Math.sinh, 1, 1],
		cosh: [Math.cosh, 1, 1],
		tanh: [Math.tanh, 1, 1],
		exp: [Math.exp, 1, 1],
		ln: [Math.log, 1, 1],
		log: [Math.log, 1, 1],
		log10: [Math.log10, 1, 1],
		log2: [Math.log2, 1, 1],
		sqrt: [Math.sqrt, 1, 1],
		abs: [Math.abs, 1, 1],
		floor: [Math.floor, 1, 1],
		ceil: [Math.ceil, 1, 1],
		round: [Math.round, 1, 1],
		sign: [Math.sign, 1, 1],
		min: [Math.min, 2, 8],
		max: [Math.max, 2, 8],
		erf: [erf, 1, 1],
		normpdf: [normpdf, 1, 3],
		normcdf: [normcdf, 1, 3],
		tpdf: [tpdf, 2, 2],
		chi2pdf: [chi2pdf, 2, 2],
		exppdf: [exppdf, 2, 2],
		unifpdf: [unifpdf, 3, 3],
	};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** The names `plot` expressions may call, for the system prompt and errors. */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

export class ExprError extends Error {}

const MAX_LENGTH = 500;
const MAX_DEPTH = 64;

/** Parses `source` (a function of `x`) into a plain function. Throws `ExprError`. */
export function compile(source: string): Fn {
	if (source.length > MAX_LENGTH) {
		throw new ExprError(`expresión demasiado larga (máx. ${MAX_LENGTH})`);
	}
	const tokens = tokenize(source);
	let i = 0;
	let depth = 0;
	const peek = () => tokens[i];
	const next = () => tokens[i++];
	const expect = (v: string) => {
		const tok = next();
		if (tok?.v !== v) {
			throw new ExprError(
				tok ? `se esperaba «${v}» y llegó «${tok.v}»` : `falta «${v}»`,
			);
		}
	};

	// Precedence, low to high: + -, * / (and implicit 2x), unary -, ^ (right).
	const sum = (): Node => {
		let a = product();
		for (let tok = peek(); tok?.v === "+" || tok?.v === "-"; tok = peek()) {
			next();
			a = { t: "bin", op: tok.v, a, b: product() };
		}
		return a;
	};
	const product = (): Node => {
		let a = unary();
		for (;;) {
			const tok = peek();
			if (tok?.v === "*" || tok?.v === "/") {
				next();
				a = { t: "bin", op: tok.v, a, b: unary() };
			} else if (tok && (tok.kind === "name" || tok.v === "(")) {
				// Implicit multiplication: `2x`, `2 pi`, `3(x+1)`.
				a = { t: "bin", op: "*", a, b: unary() };
			} else return a;
		}
	};
	const unary = (): Node => {
		if (peek()?.v === "-") {
			next();
			return { t: "neg", a: unary() };
		}
		if (peek()?.v === "+") {
			next();
			return unary();
		}
		return power();
	};
	const power = (): Node => {
		const a = atom();
		if (peek()?.v === "^") {
			next();
			return { t: "bin", op: "^", a, b: unary() };
		}
		return a;
	};
	const atom = (): Node => {
		if (++depth > MAX_DEPTH) throw new ExprError("expresión demasiado anidada");
		try {
			const tok = next();
			if (!tok) throw new ExprError("la expresión termina antes de tiempo");
			if (tok.kind === "num") return { t: "num", v: tok.n };
			if (tok.v === "(") {
				const inner = sum();
				expect(")");
				return inner;
			}
			if (tok.kind === "name") {
				if (tok.v === "x") return { t: "var" };
				if (Object.hasOwn(CONSTANTS, tok.v)) {
					return { t: "num", v: CONSTANTS[tok.v] as number };
				}
				const entry = Object.hasOwn(FUNCTIONS, tok.v)
					? FUNCTIONS[tok.v]
					: undefined;
				if (!entry) throw new ExprError(`nombre desconocido «${tok.v}»`);
				const [f, min, max] = entry;
				expect("(");
				const args = [sum()];
				while (peek()?.v === ",") {
					next();
					args.push(sum());
				}
				expect(")");
				if (args.length < min || args.length > max) {
					throw new ExprError(
						`${tok.v} lleva ${min === max ? min : `${min} a ${max}`} argumentos`,
					);
				}
				return { t: "call", f, args };
			}
			throw new ExprError(`«${tok.v}» fuera de lugar`);
		} finally {
			depth--;
		}
	};

	const tree = sum();
	const rest = peek();
	if (rest) throw new ExprError(`«${rest.v}» fuera de lugar`);
	return (x) => evaluate(tree, x);
}

function evaluate(node: Node, x: number): number {
	switch (node.t) {
		case "num":
			return node.v;
		case "var":
			return x;
		case "neg":
			return -evaluate(node.a, x);
		case "call":
			return node.f(...node.args.map((a) => evaluate(a, x)));
		case "bin": {
			const a = evaluate(node.a, x);
			const b = evaluate(node.b, x);
			switch (node.op) {
				case "+":
					return a + b;
				case "-":
					return a - b;
				case "*":
					return a * b;
				case "/":
					return a / b;
				case "^":
					return a ** b;
			}
		}
	}
}

type Token =
	| { kind: "num"; v: string; n: number }
	| { kind: "name" | "op"; v: string };

function tokenize(source: string): Token[] {
	const out: Token[] = [];
	const re =
		/\s*(?:(\d+(?:\.\d*)?(?:e[+-]?\d+)?|\.\d+)|([a-z][a-z0-9]*)|(\*\*|[-+*/^(),]))/giy;
	let at = 0;
	while (at < source.length) {
		re.lastIndex = at;
		const m = re.exec(source);
		if (!m) {
			if (/^\s*$/.test(source.slice(at))) break;
			const c = source.slice(at).trim()[0];
			throw new ExprError(`carácter no permitido «${c}»`);
		}
		at = re.lastIndex;
		if (m[1]) out.push({ kind: "num", v: m[1], n: Number(m[1]) });
		else if (m[2]) out.push({ kind: "name", v: m[2].toLowerCase() });
		else if (m[3]) out.push({ kind: "op", v: m[3] === "**" ? "^" : m[3] });
	}
	return out;
}
