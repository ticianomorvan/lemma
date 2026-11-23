/**
 * `mermaid`: Mermaid with `securityLevel: 'strict'` and SVG text labels (no
 * HTML inside the SVG), themed from our tokens. Colours are baked into its
 * output, so a theme change renders again.
 */
import mermaid from "mermaid";
import { use } from "react";
import { cached } from "./cache.ts";
import { parseSvg } from "./sanitize-svg.ts";
import { SvgNode } from "./svg-node.tsx";
import { type Scheme, token, useScheme } from "./theme.ts";

const MAX_SOURCE = 20_000;
const renders = new Map<string, Promise<SVGSVGElement>>();
/** Mermaid keeps global config, so renders take turns. */
let queue: Promise<unknown> = Promise.resolve();
let seq = 0;

function render(source: string, scheme: Scheme): Promise<SVGSVGElement> {
	const run = queue.then(async () => {
		if (source.length > MAX_SOURCE) {
			throw new Error(`el diagrama es demasiado largo (máx. ${MAX_SOURCE} caracteres)`);
		}
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: "strict",
			htmlLabels: false,
			theme: "base",
			darkMode: scheme === "dark",
			fontFamily: token("--font-sans") || "sans-serif",
			themeVariables: {
				background: token("--card"),
				mainBkg: token("--card"),
				primaryColor: token("--primary-soft"),
				primaryTextColor: token("--foreground"),
				primaryBorderColor: token("--primary"),
				secondaryColor: token("--secondary"),
				tertiaryColor: token("--paper"),
				lineColor: token("--muted-foreground"),
				textColor: token("--foreground"),
				noteBkgColor: token("--highlight"),
				noteTextColor: token("--highlight-foreground"),
				fontSize: "14px",
			},
		});
		await mermaid.parse(source);
		const id = `mermaid-${++seq}`;
		try {
			const { svg } = await mermaid.render(id, source);
			return parseSvg(svg);
		} finally {
			// A failed render leaves its scratch element in <body>.
			document.getElementById(`d${id}`)?.remove();
			document.getElementById(id)?.remove();
		}
	});
	queue = run.catch(() => {});
	return run;
}

export default function Mermaid({ source }: { source: string }) {
	const scheme = useScheme();
	const svg = use(
		cached(renders, `${scheme}\0${source}`, () => render(source, scheme)),
	);
	return (
		<div className="block-scroll">
			<SvgNode svg={svg} className="mermaid" label="Diagrama" />
		</div>
	);
}
