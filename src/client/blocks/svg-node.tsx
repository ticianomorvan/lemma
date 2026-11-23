import { useLayoutEffect, useRef } from "react";

/**
 * Shows an already sanitized SVG element. It is inserted as a node (a fresh
 * clone each mount), never serialized back to markup and parsed again.
 */
export function SvgNode({
	svg,
	className,
	label,
}: {
	svg: SVGSVGElement;
	className?: string;
	label?: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const copy = document.importNode(svg, true);
		el.replaceChildren(copy);
	}, [svg]);
	return <div ref={ref} className={className} role="img" aria-label={label} />;
}
