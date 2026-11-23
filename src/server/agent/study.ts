/**
 * The `study` MCP server: Lemma's own tools, run in this process. For now it
 * holds `calc`; the math lives in `src/server/tools/calc/`.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { calc } from "../tools/calc/calc.ts";
import { DISTRIBUTION_USAGE } from "../tools/calc/distributions.ts";

/** The name Claude calls `calc` by, as the hook and `canUseTool` see it. */
export const CALC_TOOL = "mcp__study__calc";

const DESCRIPTION = `Evaluate a math expression exactly as mathjs does (https://mathjs.org/docs/expressions/syntax.html) and return its value, or an error.
Use it for every number you state in a worked solution.
- Arithmetic, powers, roots, logs, matrices, units, complex numbers, combinations(n, k), factorial(n), gamma(x), erf(x), sum, mean, std, …
- Distributions (each cdf is P(X ≤ x); each inv… is the quantile): ${DISTRIBUTION_USAGE.join(", ")}.
- Several lines are evaluated in order and return one value each; a line ending in ";" returns nothing. Names you assign last for this call only.
- The expression is at most 2 KB, the result at most 10 KB, and a call stops after 1 s.`;

/** A new server per session: one MCP server instance serves one connection. */
export function studyServer() {
	return createSdkMcpServer({
		name: "study",
		alwaysLoad: true,
		tools: [
			tool(
				"calc",
				DESCRIPTION,
				{ expr: z.string().describe("A mathjs expression") },
				async ({ expr }) => {
					const result = await calc(expr);
					return result.ok
						? { content: [{ type: "text", text: result.value }] }
						: {
								content: [{ type: "text", text: result.error }],
								isError: true,
							};
				},
				{ annotations: { readOnlyHint: true, openWorldHint: false } },
			),
		],
	});
}
