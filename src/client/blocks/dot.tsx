/**
 * `dot`: Graphviz through `@viz-js/viz` (WASM). Default black lines and text
 * take the theme's ink in CSS (blocks.css), so a graph follows dark mode
 * without re-rendering; colours the source sets itself are kept.
 */
import { instance, type Viz } from "@viz-js/viz";
import { sanitizeSvg } from "./sanitize-svg.ts";
import { SvgBlock } from "./svg-node.tsx";

const FONT = "Helvetica,Arial,sans-serif";
let viz: Promise<Viz> | undefined;

async function render(source: string): Promise<SVGSVGElement> {
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
	return (
		<SvgBlock kind="dot" cacheKey={source} render={() => render(source)} />
	);
}
