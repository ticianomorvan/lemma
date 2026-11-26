/**
 * `typst`: a Typst snippet, compiled on the server (`POST /api/typst/svg`, see
 * server/typst/) so the page never loads the compiler. The SVG comes back
 * like any other renderer's: parsed and sanitized here, then inserted as a
 * node. Typst draws each glyph as a `<use>` of a path in the same SVG; the
 * ids are hashes of the glyph, so two blocks that share an id share its shape.
 */
import type { TypstSvgResponse } from "../../shared/protocol.ts";
import { parseSvg } from "./sanitize-svg.ts";
import { SvgBlock } from "./svg-node.tsx";

async function render(source: string): Promise<SVGSVGElement> {
	const res = await fetch("/api/typst/svg", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ source }),
	});
	const body = (await res.json().catch(() => null)) as
		| (TypstSvgResponse & { error?: { message?: string } })
		| null;
	if (!res.ok || !body?.svg) {
		throw new Error(
			body?.error?.message ?? `el servidor respondió ${res.status}`,
		);
	}
	const svg = parseSvg(body.svg);
	// typst.ts's stylesheet is for its own viewer (and `svg { fill: none }`
	// would reach every SVG on the page); the drawing doesn't need it.
	for (const style of svg.querySelectorAll("style")) style.remove();
	// Typst sizes in points. Show it at its natural size, shrinking to the
	// column down to 60% of that; below that it scrolls.
	const width = (Number.parseFloat(svg.getAttribute("width") ?? "") * 4) / 3;
	if (width > 0) {
		svg.removeAttribute("height");
		svg.setAttribute("width", String(Math.round(width)));
		svg.style.minWidth = `${Math.round(width * 0.6)}px`;
	}
	return svg;
}

export default function Typst({ source }: { source: string }) {
	return (
		<SvgBlock kind="typst" cacheKey={source} render={() => render(source)} />
	);
}
