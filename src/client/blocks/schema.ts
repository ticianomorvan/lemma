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
	const result = schema.safeParse(json);
	if (!result.success) {
		const issue = result.error.issues[0];
		const at = issue?.path.length ? ` (en ${issue.path.join(".")})` : "";
		throw new Error(`${issue?.message ?? "bloque inválido"}${at}`);
	}
	return result.data;
}
