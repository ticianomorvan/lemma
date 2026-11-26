/**
 * What the client's diagram renderers accept, for the server's system prompt
 * (agent/prompt.ts) and the renderers themselves (client/blocks) to agree on.
 */

/** The fenced block kinds the client draws. */
export const BLOCK_KIND_NAMES = [
	"dot",
	"proof",
	"fitch",
	"plot",
	"vega-lite",
	"mermaid",
] as const;

/** The functions a `plot` expression may call, as the prompt shows them. */
export const PLOT_FUNCTIONS = [
	"sin",
	"cos",
	"tan",
	"asin",
	"acos",
	"atan",
	"sinh",
	"cosh",
	"tanh",
	"exp",
	"ln",
	"log10",
	"log2",
	"sqrt",
	"abs",
	"floor",
	"ceil",
	"round",
	"sign",
	"min",
	"max",
	"erf",
	"normpdf(x, mu, sigma)",
	"normcdf(x, mu, sigma)",
	"tpdf(x, df)",
	"chi2pdf(x, df)",
	"exppdf(x, lambda)",
	"unifpdf(x, a, b)",
] as const;
