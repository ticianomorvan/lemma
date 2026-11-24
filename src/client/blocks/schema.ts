/**
 * The JSON schemas of the block kinds that are our own visuals: `proof`,
 * `fitch` and `plot` (docs/spec.md → Rendering pipeline). Every formula is
 * LaTeX for KaTeX; every `plot` expression is a function of `x` in the
 * language of `expr.ts`.
 */
import { z } from "zod";

export type ProofNode = {
	conclusion: string;
	rule?: string;
	premises?: ProofNode[];
	discharged?: string;
};

/**
 * A natural-deduction or sequent tree. On a leaf, `discharged` is the label of
 * a discharged assumption (`[p]¹`); on a rule, the label it discharges (`→I¹`).
 */
export const proofSchema: z.ZodType<ProofNode> = z.lazy(() =>
	z.strictObject({
		conclusion: z.string(),
		rule: z.string().optional(),
		premises: z.array(proofSchema).max(8).optional(),
		discharged: z.union([z.string(), z.number()]).transform(String).optional(),
	}),
);

export const fitchSchema = z.strictObject({
	lines: z
		.array(
			z.strictObject({
				formula: z.string(),
				justification: z.string().optional(),
				/** 0 is the main proof; each subproof adds one. */
				depth: z.int().min(0).max(8),
				/** Opens a subproof (or is a premise at depth 0). Inferred when the depth grows. */
				assumption: z.boolean().optional(),
			}),
		)
		.min(1)
		.max(200),
});
export type Fitch = z.infer<typeof fitchSchema>;

const point = z.tuple([z.number(), z.number()]);
const range = z
	.tuple([z.number(), z.number()])
	.refine(([a, b]) => a < b, "el intervalo debe ir de menor a mayor");
const color = z
	.enum(["primary", "success", "warning", "destructive", "muted"])
	.optional();

export const plotItemSchema = z.union([
	z.strictObject({
		fn: z.string(),
		from: z.number().optional(),
		to: z.number().optional(),
		label: z.string().optional(),
		color,
		dashed: z.boolean().optional(),
	}),
	z.strictObject({
		point,
		label: z.string().optional(),
		open: z.boolean().optional(),
		color,
	}),
	z.strictObject({
		region: z.strictObject({
			fn: z.string(),
			from: z.number().nullable().optional(),
			to: z.number().nullable().optional(),
		}),
		label: z.string().optional(),
		color,
	}),
	z.strictObject({
		stem: z.array(point).min(1).max(500),
		label: z.string().optional(),
		color,
	}),
	z.strictObject({
		step: z.array(point).min(1).max(500),
		label: z.string().optional(),
		color,
	}),
	z.strictObject({
		vline: z.number(),
		label: z.string().optional(),
		color,
	}),
]);
export type PlotItem = z.infer<typeof plotItemSchema>;

export const plotSchema = z.strictObject({
	xDomain: range,
	yDomain: range,
	xLabel: z.string().optional(),
	yLabel: z.string().optional(),
	items: z.array(plotItemSchema).min(1).max(40),
});
export type Plot = z.infer<typeof plotSchema>;

/** Parses a block's JSON source, with an error message a student can read. */
export function parseBlock<T>(schema: z.ZodType<T>, source: string): T {
	let json: unknown;
	try {
		json = JSON.parse(source);
	} catch (e) {
		throw new Error(`JSON inválido: ${(e as Error).message}`);
	}
	if (depth(json) > MAX_DEPTH) {
		throw new Error(`el bloque está demasiado anidado (máx. ${MAX_DEPTH})`);
	}
	const result = schema.safeParse(json);
	if (!result.success) {
		const issue = closest(result.error.issues[0]);
		const at = issue?.path.length ? ` (en ${issue.path.join(".")})` : "";
		throw new Error(`${issue?.message ?? "bloque inválido"}${at}`);
	}
	return result.data;
}

const MAX_DEPTH = 64;

/** How deeply `value` nests, counted before zod's recursive schemas see it. */
function depth(value: unknown, level = 0): number {
	if (level > MAX_DEPTH || !value || typeof value !== "object") return level;
	let max = level;
	for (const v of Object.values(value)) {
		max = Math.max(max, depth(v, level + 1));
		if (max > MAX_DEPTH) break;
	}
	return max;
}

type Issue = z.core.$ZodIssue;

/**
 * For an item that matches none of a union's shapes, zod reports only
 * "Invalid input". The shape with the fewest problems is the one meant, so
 * report its first problem instead (say, an unknown key `colour`).
 */
function closest(issue: Issue | undefined): Issue | undefined {
	if (issue?.code !== "invalid_union" || !issue.errors.length) return issue;
	const best = issue.errors.reduce((a, b) => (b.length < a.length ? b : a));
	const inner = closest(best[0]);
	return inner ? { ...inner, path: [...issue.path, ...inner.path] } : issue;
}
