import katex from "katex";
import { memo } from "react";

/**
 * One formula rendered by KaTeX. `trust` stays off, so `\href` and friends
 * render as errors, never as links or HTML; errors show inline in red.
 */
export const Tex = memo(function Tex({
	tex,
	display = false,
	className,
}: {
	tex: string;
	display?: boolean;
	className?: string;
}) {
	const html = katex.renderToString(tex, {
		throwOnError: false,
		strict: "ignore",
		// A formula can't blow up the page: no huge sizes, no macro bombs.
		maxSize: 10,
		maxExpand: 100,
		displayMode: display,
		output: "htmlAndMathml",
	});
	return (
		<span
			className={className}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output, `trust: false`
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
});
