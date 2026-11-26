/**
 * `vega-lite`: compiled to Vega and rendered to a static SVG. Vega's own
 * expression language runs through `vega-interpreter` (no `new Function`),
 * and the loader refuses every URL, so a spec can neither run code nor fetch.
 */

import {
	Suspense,
	useDeferredValue,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { parse, View, loader as vegaLoader } from "vega";
import { expressionInterpreter } from "vega-interpreter";
import { type Config, compile, type TopLevelSpec } from "vega-lite";
import { parseSvg } from "./sanitize-svg.ts";
import { SvgBlock } from "./svg-node.tsx";
import { type Scheme, tokens, useScheme } from "./theme.ts";

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

function config(scheme: Scheme): Config {
	const t = tokens(scheme);
	const ink = t("--foreground");
	const muted = t("--muted-foreground");
	const line = t("--border");
	const font = t("--font-sans") || "sans-serif";
	return {
		background: "transparent",
		font,
		view: { stroke: null },
		mark: { color: t("--primary") },
		range: {
			category: [
				t("--primary"),
				t("--warning"),
				t("--success"),
				t("--destructive"),
				t("--subtle"),
			],
		},
		axis: {
			domainColor: t("--input"),
			gridColor: line,
			tickColor: t("--input"),
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

/**
 * Vega runs on the main thread, so a spec that asks for millions of rows or
 * pixels would freeze the page. Data comes as `values` (capped by the block's
 * length); these keys generate rows of their own, so they're capped or refused.
 */
const REFUSED = new Set(["sequence", "keyvals"]);
const CAPS: Record<string, number> = {
	maxbins: 500,
	steps: 1000,
	step: 4000,
	width: 4000,
	height: 4000,
};

export function checkSpec(node: unknown, depth = 0, key = ""): void {
	if (depth > 64) throw new Error("la especificación está demasiado anidada");
	if (Array.isArray(node)) {
		for (const v of node) checkSpec(v, depth + 1, key);
		return;
	}
	if (!node || typeof node !== "object") return;
	for (const [k, v] of Object.entries(node)) {
		if (REFUSED.has(k)) throw new Error(`no se acepta \`${k}\``);
		const cap = Object.hasOwn(CAPS, k) ? CAPS[k] : undefined;
		if (cap !== undefined && typeof v === "number" && v > cap) {
			throw new Error(`\`${k}\` es demasiado grande (máx. ${cap})`);
		}
		// A bin's `step` is a width in data units: a tiny one makes millions of bins.
		if (key === "bin" && (k === "step" || k === "steps")) {
			throw new Error("usá `maxbins` en lugar de `step` en `bin`");
		}
		checkSpec(v, depth + 1, k);
	}
}

async function render(
	source: string,
	width: number,
	scheme: Scheme,
): Promise<SVGSVGElement> {
	let spec: TopLevelSpec;
	try {
		spec = JSON.parse(source);
	} catch (e) {
		throw new Error(`JSON inválido: ${(e as Error).message}`);
	}
	if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
		throw new Error("la especificación debe ser un objeto JSON");
	}
	checkSpec(spec);
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
	const vg = compile(sized, {
		config: config(scheme),
		logger: logger as never,
	}).spec;
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
	const [measured, setWidth] = useState(0);
	// A resize keeps the drawn chart until the new width has rendered.
	const width = useDeferredValue(measured);
	const scheme = useScheme();
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		// The content box (inside the padding), in steps of 40px so a resize
		// re-renders only now and then; narrower than 200px, the box scrolls.
		const measure = () => {
			const style = getComputedStyle(el);
			const inner =
				el.clientWidth -
				Number.parseFloat(style.paddingLeft) -
				Number.parseFloat(style.paddingRight);
			setWidth(Math.max(200, Math.floor(inner / 40) * 40));
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);
	return (
		<div ref={ref} className="diagram-scroll">
			{width > 0 && (
				<Suspense fallback={<div className="diagram-loading" data-pending />}>
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
			render={() => render(source, width, scheme)}
			scroll={false}
		/>
	);
}
