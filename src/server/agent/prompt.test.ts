import { expect, test } from "bun:test";
import { FUNCTION_NAMES } from "../../client/blocks/expr.ts";
import { BLOCK_KINDS } from "../../client/blocks/kinds.ts";
import { CONVENTIONS, PLOT_FUNCTIONS } from "./prompt.ts";

test("the prompt lists exactly the functions plot expressions accept", () => {
	const names = PLOT_FUNCTIONS.map((f) => f.replace(/\(.*$/, ""));
	expect(names.toSorted()).toEqual(FUNCTION_NAMES.toSorted());
});

test("the prompt describes every block kind the client renders", () => {
	for (const kind of Object.keys(BLOCK_KINDS)) {
		expect(CONVENTIONS).toContain(`- \`${kind}\`:`);
	}
});
