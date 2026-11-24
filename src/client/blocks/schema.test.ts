import { expect, test } from "bun:test";
import { parseBlock, plotSchema, proofSchema } from "./schema.ts";

test("a bad plot item names its own problem, not the union's", () => {
	const source = JSON.stringify({
		xDomain: [0, 1],
		yDomain: [0, 1],
		items: [{ fn: "x", colour: "primary" }],
	});
	expect(() => parseBlock(plotSchema, source)).toThrow(/colour/);
	expect(() => parseBlock(plotSchema, source)).toThrow(/en items\.0/);
});

test("broken JSON says so", () => {
	expect(() => parseBlock(plotSchema, "{")).toThrow(/^JSON inválido/);
});

test("a block nested past the cap is refused before zod", () => {
	let node = '{"conclusion":"p"}';
	for (let i = 0; i < 80; i++) node = `{"conclusion":"p","premises":[${node}]}`;
	expect(() => parseBlock(proofSchema, node)).toThrow("demasiado anidado");
});
