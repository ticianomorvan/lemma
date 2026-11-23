import { describe, expect, test } from "bun:test";
import { calc, MAX_INPUT_BYTES } from "./calc.ts";
import { run } from "./engine.ts";

/**
 * Reference values computed with SciPy 1.18 (`scipy.stats`), labelled in R's
 * notation (`pbinom(4, 10, 0.3)` is `stats.binom.cdf(4, 10, 0.3)`), or closed
 * forms where noted. `calc` prints 14 significant digits; the tolerance is 1e-9.
 */
const KNOWN: [expr: string, value: number, reference: string][] = [
	// The three from the plan.
	["binomcdf(10, 0.3, 4)", 0.8497316674, "pbinom(4, 10, 0.3)"],
	["normcdf(1.96)", 0.9750021048517795, "pnorm(1.96)"],
	["invt(0.975, 9)", 2.262157162798205, "qt(0.975, 9)"],
	// Binomial.
	["binompdf(10, 0.3, 3)", 0.266827932, "dbinom(3, 10, 0.3)"],
	["binompdf(5, 0.5, 0)", 0.03125, "0.5^5"],
	["binomcdf(20, 0.5, 10)", 0.5880985260009766, "pbinom(10, 20, 0.5)"],
	["invbinom(0.5, 10, 0.3)", 3, "qbinom(0.5, 10, 0.3)"],
	["invbinom(0.95, 20, 0.5)", 14, "qbinom(0.95, 20, 0.5)"],
	// Poisson.
	["poissonpdf(2, 3)", 0.1804470443154836, "e^-2 · 2^3 / 3!"],
	["poissoncdf(2, 3)", 0.8571234604985472, "ppois(3, 2)"],
	["invpoisson(0.95, 2)", 5, "qpois(0.95, 2)"],
	// Normal.
	["normpdf(0)", 0.3989422804014327, "1 / sqrt(2π)"],
	["normcdf(110, 100, 15)", 0.7475074624530771, "pnorm(110, 100, 15)"],
	["normcdf(-1.645)", 0.04998490553912138, "pnorm(-1.645)"],
	["invnorm(0.975)", 1.959963984540054, "qnorm(0.975)"],
	["invnorm(0.05, 100, 15)", 75.32719559572791, "qnorm(0.05, 100, 15)"],
	// Student's t.
	["tpdf(0, 1)", 0.3183098861837907, "1 / π"],
	["tcdf(2, 5)", 0.9490302605850709, "pt(2, 5)"],
	["tcdf(0, 30)", 0.5, "symmetry"],
	["invt(0.95, 20)", 1.724718242920787, "qt(0.95, 20)"],
	// χ².
	["chi2pdf(1, 2)", 0.3032653298563167, "e^-0.5 / 2"],
	["chi2cdf(3.841458820694124, 1)", 0.95, "pchisq(qchisq(0.95, 1), 1)"],
	["invchi2(0.95, 1)", 3.841458820694124, "qchisq(0.95, 1)"],
	["invchi2(0.95, 10)", 18.30703805327515, "qchisq(0.95, 10)"],
	// mathjs itself.
	["combinations(10, 3)", 120, "C(10, 3)"],
	["factorial(5)", 120, "5!"],
	["erf(1)", 0.8427007929497149, "erf(1)"],
];

describe("calc engine: known values (tolerance 1e-9)", () => {
	for (const [expr, value, reference] of KNOWN) {
		test(`${expr} ≈ ${value} (${reference})`, () => {
			const result = run(expr);
			if (!result.ok) throw new Error(result.error);
			expect(Math.abs(Number(result.value) - value)).toBeLessThan(1e-9);
		});
	}

	test("bad arguments say how to call the function", () => {
		expect(run("binomcdf(10, 2, 4)")).toEqual({
			ok: false,
			error: "invalid arguments: binomcdf(n, p, k)",
		});
		expect(run("invt(1.5, 9)").ok).toBe(false);
		expect(run("binomcdf(10, 0.3)")).toEqual({
			ok: false,
			error: "invalid arguments: binomcdf(n, p, k)",
		});
	});

	test("an expression with nothing to show is an error, not an empty result", () => {
		for (const expr of ["x = 3;", "", "  "])
			expect(run(expr)).toEqual({
				ok: false,
				error: "nothing to show: the last line ends in ';' or is empty",
			});
	});

	test("several statements: one line each, `;` hides one, fresh scope", () => {
		expect(run("x = 3\nx^2")).toEqual({ ok: true, value: "3\n9" });
		expect(run("x = 3; x^2")).toEqual({ ok: true, value: "9" });
		expect(run("x").ok).toBe(false);
	});
});

describe("calc engine: the lockdown", () => {
	for (const expr of [
		"import({x: 1}, {override: true})",
		'evaluate("1 + 1")',
		'parse("1 + 1")',
		'compile("1 + 1")',
		"parser()",
		'simplify("x + x")',
		'derivative("x^2", "x")',
		'createUnit("lemma")',
		'config({number: "BigNumber"})',
	]) {
		test(`rejects ${expr}`, () => {
			const result = run(expr);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error).toEndWith("is disabled");
		});
	}

	test("rejects reaching JavaScript through properties", () => {
		expect(run("cos.constructor").ok).toBe(false);
		expect(run('cos["constructor"]("return 1")()').ok).toBe(false);
	});
});

describe("calc in a Worker", () => {
	test("returns the value", async () => {
		expect(await calc("binomcdf(10, 0.3, 4)")).toEqual({
			ok: true,
			value: "0.8497316674",
		});
	});

	test("kills an endless loop at about 1 s, and the next call still works", async () => {
		const start = performance.now();
		// 10^12 cosines: hours of work in a few megabytes.
		const result = await calc(
			"f(x) = sum(map(1:1e6, cos)); sum(map(1:1e6, f))",
		);
		const elapsed = performance.now() - start;
		expect(result).toEqual({ ok: false, error: "stopped after 1 s" });
		expect(elapsed).toBeGreaterThan(950);
		// Generous: a busy CI machine can fire the timer late.
		expect(elapsed).toBeLessThan(5000);
		expect(await calc("1 + 1")).toEqual({ ok: true, value: "2" });
	});

	test("runs calls one at a time", async () => {
		const loop = calc("f(x) = sum(map(1:1e6, cos)); sum(map(1:1e6, f))");
		let looped = false;
		void loop.then(() => {
			looped = true;
		});
		expect(await calc("1 + 1")).toEqual({ ok: true, value: "2" });
		expect(looped).toBe(true);
	});

	test("rejects import and evaluate", async () => {
		expect((await calc("import({x: 1}, {override: true})")).ok).toBe(false);
		expect((await calc('evaluate("1 + 1")')).ok).toBe(false);
	});

	test("refuses input over 2 KB", async () => {
		const expr = `1${"+1".repeat(MAX_INPUT_BYTES / 2)}`;
		expect(await calc(expr)).toEqual({
			ok: false,
			error: "the expression is longer than 2 KB",
		});
		expect(await calc(`1${"+1".repeat(MAX_INPUT_BYTES / 2 - 1)}`)).toEqual({
			ok: true,
			value: String(MAX_INPUT_BYTES / 2),
		});
	});

	test("refuses output over 10 KB", async () => {
		expect(await calc("ones(100, 100)")).toEqual({
			ok: false,
			error: "the result is longer than 10 KB",
		});
	});
});
