/**
 * The math behind `calc`: a locked-down mathjs instance plus the
 * distributions in `distributions.ts`. It runs inside the calc Worker
 * (`worker.ts`); call `calc()` from `calc.ts` rather than loading mathjs on
 * the main thread.
 *
 * The lockdown follows mathjs's security guide: once our functions are in,
 * `import`, `createUnit`, `evaluate`, `parse`, `simplify` and `derivative`
 * are replaced by functions that throw, so an expression can't add functions,
 * define units or reach the parser. `compile` and `parser` give the same
 * reach as `evaluate`/`parse`, and `config` would change the instance for
 * every later expression, so those are stubbed too.
 */
import { all, create, type FactoryFunctionMap } from "mathjs";
import { DISTRIBUTIONS, type Fn } from "./distributions.ts";

/** Results longer than this (in UTF-8 bytes) are refused. */
export const MAX_OUTPUT_BYTES = 10 * 1024;

export type CalcResult =
	| { ok: true; value: string }
	| { ok: false; error: string };

const DISABLED = [
	"import",
	"createUnit",
	"evaluate",
	"parse",
	"simplify",
	"derivative",
	"compile",
	"parser",
	"config",
];

// `all` is typed as optional, but the package always exports it.
const math = create(all as FactoryFunctionMap);
const evaluate = math.evaluate;

math.import(
	Object.fromEntries(
		Object.entries(DISTRIBUTIONS).map(([name, { usage, fn, min }]) => {
			const max = fn.length;
			const signatures: Record<string, Fn> = {};
			for (let n = min; n <= max; n++) {
				signatures[Array(n).fill("number").join(", ")] = (...args) => {
					const value = fn(...args);
					if (Number.isNaN(value))
						throw new Error(`invalid arguments: ${usage}`);
					return value;
				};
			}
			return [name, math.typed(name, signatures)];
		}),
	),
);
math.import(
	Object.fromEntries(
		DISABLED.map((name) => [
			name,
			() => {
				throw new Error(`${name} is disabled`);
			},
		]),
	),
	{ override: true },
);

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** Evaluates one mathjs expression (or several, separated by `;` or lines). */
export function run(expr: string): CalcResult {
	try {
		const result = evaluate(expr, new Map());
		const value = math.isResultSet(result)
			? (result.entries as unknown[]).map(format).join("\n")
			: format(result);
		if (bytes(value) > MAX_OUTPUT_BYTES)
			return {
				ok: false,
				error: `the result is longer than ${MAX_OUTPUT_BYTES / 1024} KB`,
			};
		return { ok: true, value };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

const format = (value: unknown) => math.format(value, { precision: 14 });
