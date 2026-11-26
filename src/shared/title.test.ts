import { expect, test } from "bun:test";
import { plainTitle, titleFrom, titleParts } from "./title.ts";

test("inline math is split from text; currency and escaped dollars stay text", () => {
	expect(titleParts("Graficá $P(X>1{,}5)$ ya")).toEqual([
		{ math: false, text: "Graficá " },
		{ math: true, text: "P(X>1{,}5)" },
		{ math: false, text: " ya" },
	]);
	expect(titleParts("de $5 a $10")).toEqual([
		{ math: false, text: "de $5 a $10" },
	]);
	expect(titleParts("cuesta \\$3")).toEqual([
		{ math: false, text: "cuesta $3" },
	]);
	expect(titleParts("sin cerrar $x")).toEqual([
		{ math: false, text: "sin cerrar $x" },
	]);
});

test("plain titles: math as Unicode, no $, braces or commands", () => {
	expect(
		plainTitle("Graficá la densidad y sombreá $P(X>1{,}5)$. ¿Cuánto?"),
	).toBe("Graficá la densidad y sombreá P(X>1,5). ¿Cuánto?");
	expect(plainTitle("Derivá $(p\\to q)\\to(\\neg q\\to\\neg p)$")).toBe(
		"Derivá (p→q)→(¬q→¬p)",
	);
	expect(
		plainTitle("$\\operatorname{Var}(X)$ si $X\\sim\\mathrm{Bin}(n,p)$"),
	).toBe("Var(X) si X∼Bin(n,p)");
	expect(plainTitle("$x^2 + \\frac{1}{2}$ en $\\mathbb{R}$")).toBe(
		"x² + 1/2 en ℝ",
	);
	expect(plainTitle("cadenas sobre $\\{0,1\\}$")).toBe("cadenas sobre {0,1}");
	// A title from before step 12: its `$` were stripped, its TeX kept.
	expect(
		plainTitle("Graficá la densidad normal estándar y sombreá P(X>1{,}5). ¿…"),
	).toBe("Graficá la densidad normal estándar y sombreá P(X>1,5). ¿…");
	expect(plainTitle("Derivá (p\\to q) por deducción")).toBe(
		"Derivá (p→q) por deducción",
	);
});

test("the first message becomes a title that keeps its math and never cuts a formula", () => {
	expect(
		titleFrom("¿Por qué $\\operatorname{Var}(X) = p(1-p)$?\n\nMás texto"),
	).toBe("¿Por qué $\\operatorname{Var}(X) = p(1-p)$? Más texto");
	expect(titleFrom("Sea \\(x>0\\) y $$y$$ <!--fixture:math-->")).toBe(
		"Sea $x>0$ y $y$",
	);
	// The formula fits, the text after it is cut.
	const long = titleFrom(
		"Sombreá $P(X>1{,}5)$ bajo la normal estándar y decime cuánto vale esa probabilidad exactamente",
	);
	expect(long).toStartWith("Sombreá $P(X>1{,}5)$ bajo la normal");
	expect(long).toEndWith("…");
	expect(plainTitle(long).length).toBeLessThanOrEqual(60);
	// A formula that doesn't fit is left out whole.
	const cut = titleFrom(
		`${"a".repeat(50)} $\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$ fin`,
	);
	expect(cut).toBe(`${"a".repeat(50)}…`);
	expect(titleFrom("de $5 a $10")).toBe("de $5 a $10");
});
