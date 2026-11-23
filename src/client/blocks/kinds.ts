/**
 * The fenced block kinds that render as diagrams (docs/spec.md → Rendering
 * pipeline), with the label each one's card shows. `typst` joins in step 12.
 */
export const BLOCK_KINDS = {
	dot: "Grafo",
	proof: "Deducción",
	fitch: "Fitch",
	plot: "Gráfico",
	"vega-lite": "Datos",
	mermaid: "Diagrama",
} as const;

export type BlockKind = keyof typeof BLOCK_KINDS;

export const isBlockKind = (lang: string): lang is BlockKind =>
	Object.hasOwn(BLOCK_KINDS, lang);
