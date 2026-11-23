import { describe, expect, test } from "bun:test";
import { PLOT_FUNCTIONS } from "../../shared/blocks.ts";
import { compile, ExprError, FUNCTION_NAMES } from "./expr.ts";

describe("plot expressions", () => {
	test("evaluate arithmetic, precedence and functions", () => {
		expect(compile("1 + 2 * 3")(0)).toBe(7);
		expect(compile("2^3^2")(0)).toBe(512);
		expect(compile("-x^2")(3)).toBe(-9);
		expect(compile("2x + 1")(4)).toBe(9);
		expect(compile("3(x+1)")(1)).toBe(6);
		expect(compile("x**2")(5)).toBe(25);
		expect(compile("sin(pi/2)")(0)).toBeCloseTo(1);
		expect(compile("max(x, 0)")(-2)).toBe(0);
		expect(compile("e^x")(1)).toBeCloseTo(Math.E);
	});

	test("densities match known values", () => {
		expect(compile("normpdf(x)")(0)).toBeCloseTo(0.398942, 5);
		expect(compile("normcdf(x)")(1.96)).toBeCloseTo(0.975, 3);
		expect(compile("normpdf(x, 1, 2)")(1)).toBeCloseTo(0.199471, 5);
		expect(compile("tpdf(x, 5)")(0)).toBeCloseTo(0.379607, 5);
		expect(compile("chi2pdf(x, 3)")(2)).toBeCloseTo(0.207554, 5);
	});

	test("reject anything outside the language", () => {
		for (const bad of [
			"alert(1)",
			"constructor",
			"x.constructor",
			"__proto__(x)",
			"toString(x)",
			"x; 1",
			"[1]",
			"'a'",
			"sin x",
			"sin(1, 2)",
			"(x",
			"x)",
			"",
			"y + 1",
			`${"(".repeat(100)}x${")".repeat(100)}`,
			"x+".repeat(300),
		]) {
			expect(() => compile(bad), bad).toThrow(ExprError);
		}
	});

	test("accept exactly the functions the system prompt lists", () => {
		const listed = PLOT_FUNCTIONS.map((f) => f.replace(/\(.*$/, ""));
		expect(FUNCTION_NAMES.toSorted()).toEqual(listed.toSorted());
		expect(() => compile("log(x)")).toThrow("nombre desconocido «log»");
	});
});
