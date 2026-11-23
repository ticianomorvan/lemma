/**
 * The fenced block kinds that render as diagrams (docs/spec.md → Rendering
 * pipeline): the label each one's card shows, and the longest source it
 * accepts (block.tsx checks it before rendering). `typst` joins in step 12.
 */
export const BLOCK_KINDS = {
	dot: { label: "Grafo", maxSource: 20_000 },
	proof: { label: "Deducción", maxSource: 50_000 },
	fitch: { label: "Fitch", maxSource: 50_000 },
	plot: { label: "Gráfico", maxSource: 50_000 },
	"vega-lite": { label: "Datos", maxSource: 100_000 },
	mermaid: { label: "Diagrama", maxSource: 20_000 },
} as const;

export type BlockKind = keyof typeof BLOCK_KINDS;

export const isBlockKind = (lang: string): lang is BlockKind =>
	Object.hasOwn(BLOCK_KINDS, lang);
