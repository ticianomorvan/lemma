/** `plot`: our JSON schema drawn as SVG (plot-svg.tsx), with a legend. */
import { compilePlot, legendOf, PlotSvg } from "./plot-svg.tsx";
import { parseBlock, plotSchema } from "./schema.ts";
import { Tex } from "./tex.tsx";

export default function Plot({ source }: { source: string }) {
	const plot = parseBlock(plotSchema, source);
	const items = compilePlot(plot);
	const legend = legendOf(items);
	return (
		<>
			<div className="plot-wrap">
				<PlotSvg plot={plot} items={items} />
			</div>
			{legend.length > 0 && (
				<div className="plot-legend">
					{legend.map((l, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: a static legend
						<span key={i} className="plot-legend-item">
							<span
								className="plot-swatch"
								data-kind={l.kind}
								style={{ background: l.color }}
							/>
							<Tex tex={l.tex} />
						</span>
					))}
				</div>
			)}
		</>
	);
}
