/**
 * The shared path of the renderers that come back as SVG (Graphviz, Mermaid,
 * Vega): a render is a promise cached by its input and read with React's
 * `use()`, so the block suspends while it renders and the error boundary gets
 * a failure. A streaming answer re-renders many times a second; the cache is
 * what keeps that from redrawing a diagram.
 */
import { use, useLayoutEffect, useRef } from "react";
import { BLOCK_KINDS, type BlockKind } from "./kinds.ts";

const MAX_CACHED = 64;
const renders = new Map<string, Promise<SVGSVGElement>>();

function cached(key: string, render: () => Promise<SVGSVGElement>) {
	let hit = renders.get(key);
	if (hit) {
		// Refresh its place, so the oldest entry is the least recently used.
		renders.delete(key);
	} else {
		hit = render();
	}
	renders.set(key, hit);
	if (renders.size > MAX_CACHED) {
		const oldest = renders.keys().next().value;
		if (oldest !== undefined) renders.delete(oldest);
	}
	return hit;
}

/**
 * Shows the (already sanitized) SVG that `render` makes for `cacheKey`. It is
 * inserted as a node, a fresh clone on each mount, never serialized back to
 * markup and parsed again.
 */
export function SvgBlock({
	kind,
	cacheKey,
	render,
	scroll = true,
}: {
	kind: BlockKind;
	cacheKey: string;
	render: () => Promise<SVGSVGElement>;
	/** Off when the caller already wraps it in a scrolling box. */
	scroll?: boolean;
}) {
	const svg = use(cached(`${kind}\0${cacheKey}`, render));
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		ref.current?.replaceChildren(document.importNode(svg, true));
	}, [svg]);
	const node = (
		<div
			ref={ref}
			className={kind === "vega-lite" ? "vega" : kind}
			role="img"
			aria-label={BLOCK_KINDS[kind].label}
		/>
	);
	return scroll ? <div className="diagram-scroll">{node}</div> : node;
}
