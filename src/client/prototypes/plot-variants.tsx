import "mafs/core.css";
import {
	Coordinates,
	LaTeX,
	Line,
	Mafs,
	Plot as MafsPlot,
	Point,
	Polygon,
} from "mafs";
import type { ReactNode } from "react";
import { compile } from "../blocks/expr.ts";
import { compilePlot, legendOf, PlotSvg } from "../blocks/plot-svg.tsx";
import type { Plot, PlotItem } from "../blocks/schema.ts";
import { Tex } from "../blocks/tex.tsx";

const COLORS = {
	primary: "var(--primary)",
	success: "var(--success)",
	warning: "var(--warning)",
	destructive: "var(--destructive)",
	muted: "var(--subtle)",
} as const;

/** A tick step near `span / 6`: 1, 2 or 5 times a power of ten. */
function niceStep(span: number) {
	const raw = span / 6;
	const p = 10 ** Math.floor(Math.log10(raw));
	const m = raw / p;
	return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** Spanish numbers: a decimal comma, and no float noise. */
const fmt = (v: number) =>
	(Math.round(v * 1e6) / 1e6).toString().replace(".", ",").replace("-", "−");

type Style = {
	grid: boolean;
	ink: string;
	fill: string;
	fillOpacity: number;
	inlineLabels: boolean;
};

function Items({ plot, style }: { plot: Plot; style: Style }) {
	const [x0, x1] = plot.xDomain;
	const [y0, y1] = plot.yDomain;
	const out: ReactNode[] = [];
	plot.items.forEach((item, i) => {
		const key = i;
		const c = (item.color && COLORS[item.color]) || style.ink;
		if ("fn" in item) {
			const f = compile(item.fn);
			out.push(
				<MafsPlot.OfX
					key={key}
					y={f}
					domain={[item.from ?? x0, item.to ?? x1]}
					color={c}
					weight={2.5}
					style={item.dashed ? "dashed" : "solid"}
				/>,
			);
		} else if ("region" in item) {
			const f = compile(item.region.fn);
			const a = Math.max(item.region.from ?? x0, x0);
			const b = Math.min(item.region.to ?? x1, x1);
			const pts: [number, number][] = [[a, 0]];
			for (let k = 0; k <= 120; k++) {
				const x = a + ((b - a) * k) / 120;
				pts.push([x, Math.min(Math.max(f(x), y0), y1)]);
			}
			pts.push([b, 0]);
			const fillColor = (item.color && COLORS[item.color]) || style.fill;
			out.push(
				<Polygon
					key={key}
					points={pts}
					color={fillColor}
					fillOpacity={style.fillOpacity}
					weight={0}
				/>,
			);
		} else if ("point" in item) {
			out.push(<Point key={key} x={item.point[0]} y={item.point[1]} color={c} />);
		} else if ("stem" in item) {
			const sc = (item.color && COLORS[item.color]) || "var(--primary)";
			for (const [x, y] of item.stem) {
				out.push(
					<Line.Segment key={`${key}-${x}`} point1={[x, 0]} point2={[x, y]} color={sc} weight={2.5} />,
					<Point key={`${key}-${x}p`} x={x} y={y} color={sc} />,
				);
			}
		} else if ("step" in item) {
			const steps = item.step;
			let prevY = 0;
			let prevX = x0;
			steps.forEach(([x, y], k) => {
				out.push(
					<Line.Segment key={`${key}-${k}h`} point1={[prevX, prevY]} point2={[x, prevY]} color={c} weight={2} />,
					<Point key={`${key}-${k}o`} x={x} y={prevY} color="var(--background)" svgCircleProps={{ stroke: c, strokeWidth: 1.5, r: 4 }} />,
					<Point key={`${key}-${k}c`} x={x} y={y} color={c} />,
				);
				prevX = x;
				prevY = y;
			});
			out.push(
				<Line.Segment key={`${key}-end`} point1={[prevX, prevY]} point2={[x1, prevY]} color={c} weight={2} />,
			);
		} else if ("vline" in item) {
			out.push(
				<Line.Segment
					key={key}
					point1={[item.vline, y0]}
					point2={[item.vline, y1 * 0.92]}
					color="var(--subtle)"
					style="dashed"
					weight={1.5}
				/>,
			);
			if (style.inlineLabels && item.label) {
				out.push(
					<LaTeX key={`${key}l`} at={[item.vline, y1 * 0.97]} tex={item.label} color="var(--muted-foreground)" />,
				);
			}
		}
	});
	return <>{out}</>;
}

function Frame({
	plot,
	style,
	height,
}: {
	plot: Plot;
	style: Style;
	height: number;
}) {
	const [x0, x1] = plot.xDomain;
	const [y0, y1] = plot.yDomain;
	const xs = niceStep(x1 - x0);
	const ys = niceStep(y1 - y0);
	// The view box, to place HTML labels over the SVG in percent.
	const vx0 = x0 - (x1 - x0) * 0.04;
	const vx1 = x1 + (x1 - x0) * 0.02;
	const vy0 = y0 - (y1 - y0) * 0.1;
	const vy1 = y1 + (y1 - y0) * 0.04;
	const overlays = style.inlineLabels
		? plot.items.flatMap((item) => {
				if (!("region" in item) || !item.label) return [];
				const a = Math.max(item.region.from ?? x0, x0);
				const b = Math.min(item.region.to ?? x1, x1);
				const f = compile(item.region.fn);
				const mx = (a + b) / 2;
				const px = ((mx - vx0) / (vx1 - vx0)) * 100;
				const py = ((vy1 - Math.min(f(mx), y1) * 0.5 - 0) / (vy1 - vy0)) * 100;
				return [{ tex: item.label, px, py: Math.max(py - 18, 4), right: px > 50 }];
			})
		: [];
	return (
		<div className="pl-view" data-grid={style.grid || undefined}>
			{overlays.map((o) => (
				<span
					key={o.tex}
					className="pl-callout"
					data-right={o.right || undefined}
					style={{ left: `${o.px}%`, top: `${o.py}%` }}
				>
					<Tex tex={o.tex} />
				</span>
			))}
			<Mafs
				height={height}
				viewBox={{
					x: [x0 - (x1 - x0) * 0.04, x1 + (x1 - x0) * 0.02],
					y: [y0 - (y1 - y0) * 0.1, y1 + (y1 - y0) * 0.04],
					padding: 0,
				}}
				preserveAspectRatio={false}
				pan={false}
				zoom={false}
			>
				<Coordinates.Cartesian
					xAxis={{ lines: xs, labels: (v) => (Math.abs(v) < 1e-9 ? "" : fmt(v)) }}
					yAxis={{ lines: ys, labels: (v) => (Math.abs(v) < 1e-9 ? "0" : fmt(v)) }}
					subdivisions={false}
				/>
				<Items plot={plot} style={style} />
			</Mafs>
		</div>
	);
}

function legend(plot: Plot, style: Style): { tex: string; color: string; kind: string }[] {
	return plot.items.flatMap((item) => {
		if (!item.label || "vline" in item) return [];
		const kind = "region" in item ? "region" : "stem" in item ? "stem" : "line";
		const color =
			(item.color && COLORS[item.color]) ||
			(kind === "region" ? style.fill : kind === "stem" ? "var(--primary)" : style.ink);
		return [{ tex: item.label, color, kind }];
	});
}

/** Clásico: no grid, ink curve, the label set like a figure caption. */
export function PlotClassic({ plot }: { plot: Plot }) {
	const style: Style = {
		grid: false,
		ink: "var(--foreground)",
		fill: "var(--foreground)",
		fillOpacity: 0.14,
		inlineLabels: false,
	};
	return (
		<figure className="pl-classic">
			<Frame plot={plot} style={style} height={220} />
			<figcaption className="pl-caption">
				{legend(plot, style).map((l, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static legend
					<span key={i}>
						{i > 0 && " · "}
						<Tex tex={l.tex} />
					</span>
				))}
			</figcaption>
		</figure>
	);
}

/** Tarjeta: grid, accent colour and a swatch legend, on a card. */
export function PlotCard({ plot, title }: { plot: Plot; title: string }) {
	const style: Style = {
		grid: true,
		ink: "var(--primary)",
		fill: "var(--primary)",
		fillOpacity: 0.22,
		inlineLabels: false,
	};
	return (
		<figure className="pv-card">
			<figcaption className="pv-card-head">
				<span className="pv-chip">{title}</span>
			</figcaption>
			<Frame plot={plot} style={style} height={240} />
			<div className="pl-legend">
				{legend(plot, style).map((l, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static legend
					<span key={i} className="pl-legend-item">
						<span className="pl-swatch" data-kind={l.kind} style={{ background: l.color }} />
						<Tex tex={l.tex} />
					</span>
				))}
			</div>
		</figure>
	);
}

/** Guiado: labels written into the plot next to what they name. */
export function PlotAnnotated({ plot }: { plot: Plot }) {
	const style: Style = {
		grid: false,
		ink: "var(--primary)",
		fill: "var(--warning)",
		fillOpacity: 0.3,
		inlineLabels: true,
	};
	const lines = legend(plot, style).filter((l) => l.kind !== "region");
	return (
		<figure className="pl-annotated">
			<Frame plot={plot} style={style} height={240} />
			{lines.length > 0 && (
				<figcaption className="pl-legend">
					{lines.map((l, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static legend
						<span key={i} className="pl-legend-item">
							<span className="pl-swatch" data-kind={l.kind} style={{ background: l.color }} />
							<Tex tex={l.tex} />
						</span>
					))}
				</figcaption>
			)}
		</figure>
	);
}

export type { PlotItem };

/** Tarjeta, drawn with our own SVG renderer (d3-scale + d3-shape) instead of Mafs. */
export function PlotCardSvg({ plot, title }: { plot: Plot; title: string }) {
	const items = compilePlot(plot);
	return (
		<figure className="pv-card">
			<figcaption className="pv-card-head">
				<span className="pv-chip">{title}</span>
			</figcaption>
			<div className="pl-svg-wrap">
				<PlotSvg plot={plot} items={items} />
			</div>
			<div className="pl-legend">
				{legendOf(items).map((l, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static legend
					<span key={i} className="pl-legend-item">
						<span className="pl-swatch" data-kind={l.kind} style={{ background: l.color }} />
						<Tex tex={l.tex} />
					</span>
				))}
			</div>
		</figure>
	);
}
