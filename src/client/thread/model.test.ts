import { expect, test } from "bun:test";
import { type Block, CALC_TOOL as CALC } from "../../shared/protocol.ts";
import { toolLabel } from "./model.ts";

const tool = (name: string, text: string, done: boolean): Block => ({
	id: "m:0",
	kind: "tool",
	name,
	text,
	done,
	result: done ? { ok: true, summary: "0.8497316674" } : undefined,
});

test("a calc row names the expression's first line, partial input included", () => {
	const expr = JSON.stringify({
		expr: "binomcdf(10, 0.3, 4)\nt = invt(0.975, 9)",
	});
	expect(toolLabel(tool(CALC, expr, true))).toBe(
		"Calculó binomcdf(10, 0.3, 4) …",
	);
	expect(toolLabel(tool(CALC, expr.slice(0, 40), false))).toBe(
		"Calculando binomcdf(10, 0.3, 4) …",
	);
	expect(toolLabel(tool(CALC, '{"expr":"2 + 2"}', true))).toBe("Calculó 2 + 2");
	// Escaped quotes, and an escape cut in half mid-stream.
	expect(toolLabel(tool(CALC, '{"expr":"unit(\\"5 m\\") + 1\\', false))).toBe(
		'Calculando unit("5 m") + 1',
	);
	expect(toolLabel(tool("Read", '{"file_path":"/a/notas.md"}', true))).toBe(
		"Leyó notas.md",
	);
});
