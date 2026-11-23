/**
 * `dot`: Graphviz through `@viz-js/viz` (WASM). Default black lines and text
 * take the theme's ink in CSS (blocks.css), so a graph follows dark mode
 * without re-rendering; colours the source sets itself are kept.
 */
import { instance, type Viz } from "@viz-js/viz";
import { use } from "react";
import { cached } from "./cache.ts";
import { sanitizeSvg } from "./sanitize-svg.ts";
import { SvgNode } from "./svg-node.tsx";

const MAX_SOURCE = 20_000;
const FONT = "Helvetica,Arial,sans-serif";

let viz: Promise<Viz> | undefined;
const renders = new Map<string, Promise<SVGSVGElement>>();

async function render(source: string): Promise<SVGSVGElement> {
	if (source.length > MAX_SOURCE) {
		throw new Error(`el grafo es demasiado largo (máx. ${MAX_SOURCE} caracteres)`);
	}
	viz ??= instance();
	const svg = (await viz).renderSVGElement(source, {
		graphAttributes: { bgcolor: "transparent", fontname: FONT },
		nodeAttributes: { fontname: FONT },
		edgeAttributes: { fontname: FONT },
	});
	sanitizeSvg(svg);
	// Graphviz sizes in points. Show it at its natural size, shrinking to the
	// column down to 60% of that; below that it scrolls.
	const pt = (v: string | null) => Number.parseFloat(v ?? "") || 0;
	const width = (pt(svg.getAttribute("width")) * 4) / 3;
	svg.removeAttribute("height");
	svg.setAttribute("width", String(Math.round(width)));
	svg.style.minWidth = `${Math.round(width * 0.6)}px`;
	return svg;
}

export default function Dot({ source }: { source: string }) {
	const svg = use(cached(renders, source, () => render(source)));
	return (
		<div className="block-scroll">
			<SvgNode svg={svg} className="dot" label="Grafo" />
		</div>
	);
}
