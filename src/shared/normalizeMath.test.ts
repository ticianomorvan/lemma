import { describe, expect, test } from "bun:test";
import { normalizeMath } from "./normalizeMath.ts";

describe("mixed delimiters", () => {
	test("brackets and parens become dollars", () => {
		expect(normalizeMath("Sea \\(x\\), entonces \\[x^2 \\ge 0\\]")).toBe(
			"Sea $x$, entonces $$x^2 \\ge 0$$",
		);
	});

	test("dollars and brackets mixed in one answer", () => {
		expect(
			normalizeMath(
				"Con $p$ fijo, \\(q = 1-p\\) y\n\n$$\\operatorname{Var}(X) = pq$$",
			),
		).toBe("Con $p$ fijo, $q = 1-p$ y\n\n$$\\operatorname{Var}(X) = pq$$");
	});

	test("a multiline display bracket becomes a $$ block", () => {
		expect(
			normalizeMath("\\[\n\\begin{cases} 1 \\\\ 0 \\end{cases}\n\\]"),
		).toBe("$$\n\\begin{cases} 1 \\\\ 0 \\end{cases}\n$$");
	});

	test("code is left alone", () => {
		const text = "Usá `\\(x\\)` o\n\n```tex\n\\[x\\]\n```\n";
		expect(normalizeMath(text)).toBe(text);
	});
});

describe("currency", () => {
	test("a $ before an amount is escaped", () => {
		expect(normalizeMath("El libro cuesta $30 y el apunte $5.")).toBe(
			"El libro cuesta \\$30 y el apunte \\$5.",
		);
	});

	test("amounts with separators", () => {
		expect(normalizeMath("Entre $1,299 y $19.99")).toBe(
			"Entre \\$1,299 y \\$19.99",
		);
	});

	test("math that starts with a digit stays math", () => {
		expect(normalizeMath("Vale $2^n$ y $0$.")).toBe("Vale $2^n$ y $0$.");
	});

	test("display math is not escaped", () => {
		expect(normalizeMath("$$\n10 = 2 \\cdot 5\n$$")).toBe(
			"$$\n10 = 2 \\cdot 5\n$$",
		);
	});

	test("an escaped dollar is not escaped twice", () => {
		expect(normalizeMath("Cuesta \\$30.")).toBe("Cuesta \\$30.");
	});
});

describe("half-received chunks", () => {
	test("an open $$ block is held as raw source", () => {
		expect(normalizeMath("Entonces\n\n$$\n\\begin{align}\nx &= 1 \\\\")).toBe(
			"Entonces\n\n~~~math-pending\n\\begin{align}\nx &= 1 \\\\\n~~~\n",
		);
	});

	test("an open $$ right after a line of prose gets its own block", () => {
		expect(normalizeMath("Entonces:\n$$x^")).toBe(
			"Entonces:\n\n~~~math-pending\nx^\n~~~\n",
		);
	});

	test("an open \\[ is held too", () => {
		expect(normalizeMath("Entonces \\[\\frac{1}{")).toBe(
			"Entonces\n\n~~~math-pending\n\\frac{1}{\n~~~\n",
		);
	});

	test("an open \\( is held too", () => {
		expect(normalizeMath("Sea \\(\\alpha")).toBe(
			"Sea\n\n~~~math-pending\n\\alpha\n~~~\n",
		);
	});

	test("a closed block is rendered as soon as $$ arrives", () => {
		expect(normalizeMath("$$\nx = 1\n$$")).toBe("$$\nx = 1\n$$");
	});

	test("an open inline $ is left alone (remark-math keeps it as text)", () => {
		expect(normalizeMath("Sea $x = ")).toBe("Sea $x = ");
	});

	test("$$ inside a code fence or span does not count", () => {
		expect(normalizeMath("```\n$$\n```\nY `$$` también")).toBe(
			"```\n$$\n```\nY `$$` también",
		);
	});

	test("an open code fence holds nothing", () => {
		expect(normalizeMath("```tex\n$$x")).toBe("```tex\n$$x");
	});

	test("an answer interrupted mid-formula is held too", () => {
		expect(normalizeMath("Sea\n$$\nx &= 1")).toBe(
			"Sea\n\n~~~math-pending\nx &= 1\n~~~\n",
		);
	});

	test("the pending fence outlasts tildes in the body", () => {
		expect(normalizeMath("$$\\tilde{a} ~~~~ b")).toBe(
			"~~~~~math-pending\n\\tilde{a} ~~~~ b\n~~~~~\n",
		);
	});
});
