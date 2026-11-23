/**
 * `vega-lite`: compiled to Vega and rendered to a static SVG. Vega's own
 * expression language runs through `vega-interpreter` (no `new Function`),
 * and the loader refuses every URL, so a spec can neither run code nor fetch.
 */

import { Suspense, useLayoutEffect, useRef, useState } from "react";
import { parse, View, loader as vegaLoader } from "vega";
import { expressionInterpreter } from "vega-interpreter";
import { type Config, compile, type TopLevelSpec } from "vega-lite";
import { parseSvg } from "./sanitize-svg.ts";
import { SvgBlock } from "./svg-node.tsx";
import { type Scheme, token, useScheme } from "./theme.ts";

const NO_FETCH = "los datos van en `values`: no se cargan URLs";

/** A loader that refuses every URL and remembers that it did (Vega only warns). */
function refusingLoader() {
	const state = { refused: false };
	const refuse = () => {
		state.refused = true;
		return Promise.reject(new Error(NO_FETCH));
	};
	const loader = Object.assign(vegaLoader(), {
		load: refuse,
		sanitize: refuse,
		http: refuse,
		file: refuse,
	});
	return { loader, state };
}

function config(): Config {
	const ink = token("--foreground");
	const muted = token("--muted-foreground");
	const line = token("--border");
	const font = token("--font-sans") || "sans-serif";
	return {
		background: "transparent",
		font,
		view: { stroke: null },
		mark: { color: token("--primary") },
		range: {
			category: [
				token("--primary"),
				token("--warning"),
				token("--success"),
				token("--destructive"),
				token("--subtle"),
			],
		},
		axis: {
			domainColor: token("--input"),
			gridColor: line,
			tickColor: token("--input"),
			labelColor: muted,
			titleColor: ink,
			labelFont: font,
			titleFont: font,
			titleFontWeight: 500,
		},
		legend: {
			labelColor: muted,
			titleColor: ink,
			labelFont: font,
			titleFont: font,
		},
		title: { color: ink, font, fontWeight: 600 },
		header: { labelColor: muted, titleColor: ink },
	};
}

async function render(source: string, width: number): Promise<SVGSVGElement> {
	let spec: TopLevelSpec;
	try {
		spec = JSON.parse(source);
	} catch (e) {
		throw new Error(`JSON inválido: ${(e as Error).message}`);
	}
	if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
		throw new Error("la especificación debe ser un objeto JSON");
	}
	const composed = ["facet", "repeat", "concat", "hconcat", "vconcat"].some(
		(k) => k in spec,
	);
	// Without a width, a single chart fills the column.
	const sized =
		composed || "width" in spec
			? spec
			: ({
					...spec,
					width,
					autosize: { type: "fit-x", contains: "padding" },
				} as TopLevelSpec);
	const errors: string[] = [];
	const logger = {
		// Vega asks `level()` whether to log at all: 1 is errors only.
		level: (_?: number) => (_ === undefined ? 1 : logger),
		error: (...args: unknown[]) => {
			errors.push(args.map(String).join(" "));
			return logger;
		},
		warn: () => logger,
		info: () => logger,
		debug: () => logger,
	};
	const { loader, state } = refusingLoader();
	const vg = compile(sized, { config: config(), logger: logger as never }).spec;
	const view = new View(parse(vg, undefined, { ast: true }), {
		expr: expressionInterpreter,
		loader: loader as never,
		renderer: "none",
		logger: logger as never,
	});
	try {
		await view.runAsync();
		if (state.refused) throw new Error(NO_FETCH);
		if (errors.length) throw new Error(errors[0]);
		return parseSvg(await view.toSVG());
	} finally {
		view.finalize();
	}
}

export default function VegaLite({ source }: { source: string }) {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	const scheme = useScheme();
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		// Steps of 40px, so a resize re-renders only now and then.
		const measure = () =>
			setWidth(Math.max(240, Math.floor(el.clientWidth / 40) * 40));
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	return (
		<div ref={ref} className="block-scroll">
			{width > 0 && (
				<Suspense fallback={<div className="block-loading" />}>
					<Chart source={source} width={width} scheme={scheme} />
				</Suspense>
			)}
		</div>
	);
}

function Chart({
	source,
	width,
	scheme,
}: {
	source: string;
	width: number;
	scheme: Scheme;
}) {
	return (
		<SvgBlock
			kind="vega-lite"
			cacheKey={`${scheme}\0${width}\0${source}`}
			render={() => render(source, width)}
			scroll={false}
		/>
	);
}
