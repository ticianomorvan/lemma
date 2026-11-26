/**
 * A QR code drawn as one SVG path, dark modules on a white card in both
 * themes (phone cameras read dark-on-light best), with the quiet zone the
 * standard asks for.
 */
import { useMemo } from "react";
import { encode } from "uqr";

const QUIET = 4;

export function Qr({ text, label }: { text: string; label: string }) {
	const { size, d } = useMemo(() => {
		const { size, data } = encode(text, { ecc: "M", border: 0 });
		let d = "";
		data.forEach((row, y) => {
			row.forEach((dark, x) => {
				if (dark) d += `M${x + QUIET} ${y + QUIET}h1v1h-1z`;
			});
		});
		return { size: size + 2 * QUIET, d };
	}, [text]);
	return (
		<svg
			role="img"
			aria-label={label}
			viewBox={`0 0 ${size} ${size}`}
			shapeRendering="crispEdges"
			className="aspect-square w-full rounded-md bg-white"
		>
			<path d={d} fill="#000" />
		</svg>
	);
}
