import { expect, test } from "bun:test";
import { BLOCK_KIND_NAMES } from "../../shared/blocks.ts";
import { CONVENTIONS } from "./prompt.ts";

test("the prompt describes every block kind the client renders", () => {
	for (const kind of BLOCK_KIND_NAMES) {
		expect(CONVENTIONS).toContain(`- \`${kind}\`:`);
	}
});
