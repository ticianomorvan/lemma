/**
 * The `plot` block drawn as plain SVG: d3-scale for the axes, d3-shape for the
 * paths, our CSS variables for colour. Static on purpose (no pan or zoom), so
 * it scrolls with the page on a phone like any other figure.
 */
import { scaleLinear } from "d3-scale";
import { area, line } from "d3-shape";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { compile, type Fn } from "./expr.ts";
import type { Plot, PlotItem } from "./schema.ts";
import { Tex } from "./tex.tsx";

const COLORS = {
	primary: "var(--primary)",
	success: "var(--success)",
	warning: "var(--warning)",
	destructive: "var(--destructive)",
	muted: "var(--subtle)",
} as const;

/** The default colour of each kind of item, in order of appearance. */
const SERIES = [
	"var(--primary)",
	"var(--warning)",
	"var(--success)",
	"var(--destructive)",
];

/** Spanish numbers: a decimal comma, a real minus sign, no float noise. */
const fmt = (v: number) =>
	(Math.round(v * 1e6) / 1e6).toString().replace(".", ",").replace("-", "−");

const SAMPLES = 400;
const M = { top: 12, right: 14, bottom: 26, left: 40 };

type Compiled = { item: PlotItem; color: string; fn?: Fn };

/** Compiles every expression up front, so a bad one fails the whole block. */
export function compilePlot(plot: Plot): Compiled[] {
	let series = 0;
	return plot.items.map((item, i) => {
		const named = item.color ? COLORS[item.color] : undefined;
		const takesSeries = "fn" in item || "stem" in item || "step" in item;
		const color =
			named ??
			(takesSeries
				? (SERIES[series++ % SERIES.length] as string)
				: "var(--primary)");
		const at = (source: string) => {
			try {
				return compile(source);
			} catch (e) {
				throw new Error(`${(e as Error).message} (en items.${i}: «${source}»)`);
			}
		};
		if ("fn" in item) return { item, color, fn: at(item.fn) };
		if ("region" in item) return { item, color, fn: at(item.region.fn) };
		return { item, color };
	});
}

/** Tracks an element's content width. */
function useWidth<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		setWidth(el.clientWidth);
		const ro = new ResizeObserver(([entry]) => {
			if (entry) setWidth(Math.round(entry.contentRect.width));
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	return [ref, width] as const;
}

export function PlotSvg({ plot, items }: { plot: Plot; items: Compiled[] }) {
	const [ref, width] = useWidth<HTMLDivElement>();
	const height = width && width < 480 ? 210 : 250;
	const [x0, x1] = plot.xDomain;
	const [y0, y1] = plot.yDomain;
	const x = scaleLinear(
		[x0, x1],
		[M.left, Math.max(width - M.right, M.left + 1)],
	);
	const y = scaleLinear([y0, y1], [height - M.bottom, M.top]);
	const xTicks = x.ticks(width < 480 ? 5 : 8);
	const yTicks = y.ticks(5);
	// The x axis sits at y = 0 when 0 is in view, else along the bottom.
	const baseY = y(y0 <= 0 && 0 <= y1 ? 0 : y0);
	const clipId = `clip-${useRef(Math.random().toString(36).slice(2)).current}`;

	const out: ReactNode[] = [];
	const labels: ReactNode[] = [];
	items.forEach(({ item, color, fn }, i) => {
		const k = i;
		if ("fn" in item && fn) {
			const a = Math.max(item.from ?? x0, x0);
			const b = Math.min(item.to ?? x1, x1);
			const pts = sample(fn, a, b);
			const d = line<[number, number]>()
				.defined(([, v]) => Number.isFinite(v))
				.x(([u]) => x(u))
				.y(([, v]) => y(clampY(v, y0, y1)))(pts);
			out.push(
				<path
					key={k}
					d={d ?? ""}
					fill="none"
					stroke={color}
					strokeWidth={2.25}
					strokeLinejoin="round"
					strokeDasharray={item.dashed ? "6 4" : undefined}
				/>,
			);
		} else if ("region" in item && fn) {
			const a = Math.max(item.region.from ?? x0, x0);
			const b = Math.min(item.region.to ?? x1, x1);
			if (b > a) {
				const pts = sample(fn, a, b);
				const d = area<[number, number]>()
					.defined(([, v]) => Number.isFinite(v))
					.x(([u]) => x(u))
					.y0(baseY)
					.y1(([, v]) => y(clampY(v, y0, y1)))(pts);
				out.push(
					<path key={k} d={d ?? ""} fill={color} className="plot-region" />,
				);
			}
		} else if ("point" in item) {
			const [px, py] = item.point;
			out.push(
				<circle
					key={k}
					cx={x(px)}
					cy={y(py)}
					r={4.5}
					fill={item.open ? "var(--card)" : color}
					stroke={color}
					strokeWidth={1.75}
				/>,
			);
			if (item.label)
				labels.push(
					<Label
						key={k}
						at={x(px)}
						gap={8}
						top={y(py) - 8}
						width={width}
						tex={item.label}
					/>,
				);
		} else if ("stem" in item) {
			for (const [sx, sy] of item.stem) {
				out.push(
					<g key={`${k}-${sx}`}>
						<line
							x1={x(sx)}
							x2={x(sx)}
							y1={baseY}
							y2={y(sy)}
							stroke={color}
							strokeWidth={2.25}
						/>
						<circle cx={x(sx)} cy={y(sy)} r={4} fill={color} />
					</g>,
				);
			}
		} else if ("step" in item) {
			// A CDF: each value holds from its x to the next; open dot at each jump's foot.
			let prev: [number, number] = [x0, 0];
			item.step.forEach(([sx, sy], j) => {
				out.push(
					// biome-ignore lint/suspicious/noArrayIndexKey: steps of a static plot
					<g key={`${k}-${j}`}>
						<line
							x1={x(prev[0])}
							x2={x(sx)}
							y1={y(prev[1])}
							y2={y(prev[1])}
							stroke={color}
							strokeWidth={2}
						/>
						<circle
							cx={x(sx)}
							cy={y(prev[1])}
							r={3.5}
							fill="var(--card)"
							stroke={color}
							strokeWidth={1.5}
						/>
						<circle cx={x(sx)} cy={y(sy)} r={3.5} fill={color} />
					</g>,
				);
				prev = [sx, sy];
			});
			out.push(
				<line
					key={`${k}-end`}
					x1={x(prev[0])}
					x2={x(x1)}
					y1={y(prev[1])}
					y2={y(prev[1])}
					stroke={color}
					strokeWidth={2}
				/>,
			);
		} else if ("vline" in item) {
			out.push(
				<line
					key={k}
					x1={x(item.vline)}
					x2={x(item.vline)}
					y1={y(y0)}
					y2={M.top}
					stroke="var(--muted-foreground)"
					strokeWidth={1.25}
					strokeDasharray="4 3"
				/>,
			);
			if (item.label)
				labels.push(
					<Label
						key={k}
						at={x(item.vline)}
						gap={5}
						top={M.top - 2}
						width={width}
						tex={item.label}
					/>,
				);
		}
	});

	return (
		<div ref={ref} className="plot-svg">
			{width > 0 && (
				<svg
					width={width}
					height={height}
					role="img"
					aria-label={describePlot(plot)}
				>
					<defs>
						<clipPath id={clipId}>
							<rect
								x={M.left}
								y={M.top}
								width={Math.max(width - M.left - M.right, 0)}
								height={height - M.top - M.bottom}
							/>
						</clipPath>
					</defs>
					<g className="plot-grid">
						{xTicks.map((t) => (
							<line
								key={`gx${t}`}
								x1={x(t)}
								x2={x(t)}
								y1={M.top}
								y2={height - M.bottom}
							/>
						))}
						{yTicks.map((t) => (
							<line
								key={`gy${t}`}
								x1={M.left}
								x2={width - M.right}
								y1={y(t)}
								y2={y(t)}
							/>
						))}
					</g>
					<g className="plot-axis">
						<line x1={M.left} x2={width - M.right} y1={baseY} y2={baseY} />
						<line x1={M.left} x2={M.left} y1={M.top} y2={height - M.bottom} />
					</g>
					<g className="plot-ticks">
						{xTicks.map((t) => (
							<text
								key={`tx${t}`}
								x={x(t)}
								y={height - M.bottom + 16}
								textAnchor="middle"
							>
								{fmt(t)}
							</text>
						))}
						{yTicks.map((t) => (
							<text key={`ty${t}`} x={M.left - 6} y={y(t) + 4} textAnchor="end">
								{fmt(t)}
							</text>
						))}
					</g>
					<g clipPath={`url(#${clipId})`}>{out}</g>
				</svg>
			)}
			{labels}
			{plot.xLabel && (
				<span
					className="plot-axis-label"
					style={{ right: M.right, top: baseY - 22 }}
				>
					<Tex tex={plot.xLabel} />
				</span>
			)}
			{plot.yLabel && (
				<span
					className="plot-axis-label"
					style={{ left: M.left + 6, top: M.top - 4 }}
				>
					<Tex tex={plot.yLabel} />
				</span>
			)}
		</div>
	);
}

/** A one-line description for screen readers: the axes and the labelled items. */
function describePlot(plot: Plot) {
	const labels = plot.items.flatMap((item) => (item.label ? [item.label] : []));
	const range = (r: [number, number]) => `de ${fmt(r[0])} a ${fmt(r[1])}`;
	return `Gráfico, x ${range(plot.xDomain)}, y ${range(plot.yDomain)}${labels.length ? `: ${labels.join("; ")}` : ""}`;
}

/** A label beside the x it names; past three quarters of the width it sits on the left. */
function Label({
	at,
	gap,
	top,
	width,
	tex,
}: {
	at: number;
	gap: number;
	top: number;
	width: number;
	tex: string;
}) {
	const flip = at > width * 0.75;
	const style = flip
		? { right: width - at + gap, top }
		: { left: at + gap, top };
	return (
		<span className="plot-label" style={style}>
			<Tex tex={tex} />
		</span>
	);
}

function sample(fn: Fn, a: number, b: number): [number, number][] {
	const pts: [number, number][] = [];
	for (let i = 0; i <= SAMPLES; i++) {
		const u = a + ((b - a) * i) / SAMPLES;
		pts.push([u, fn(u)]);
	}
	return pts;
}

/** Keeps far-off values finite but outside the clip, so lines still leave the frame. */
const clampY = (v: number, y0: number, y1: number) => {
	const pad = (y1 - y0) * 10;
	return Math.min(Math.max(v, y0 - pad), y1 + pad);
};

/** The legend entries: every labelled item but points and markers, which label themselves. */
export function legendOf(items: Compiled[]) {
	return items.flatMap(({ item, color }) => {
		if (!item.label || "vline" in item || "point" in item) return [];
		const kind = "region" in item ? "region" : "stem" in item ? "stem" : "line";
		return [{ tex: item.label, color, kind }];
	});
}
