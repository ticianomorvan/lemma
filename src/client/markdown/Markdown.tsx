import { memo } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMath, PENDING_MATH } from "../../shared/normalizeMath.ts";
import { rehypeMathGlue } from "./glue.ts";

const remarkPlugins: Options["remarkPlugins"] = [
	remarkGfm,
	[remarkMath, { singleDollarTextMath: true }],
];
const remarkPluginsWithBreaks: Options["remarkPlugins"] = [
	...(remarkPlugins ?? []),
	remarkBreaks,
];
const rehypePlugins: Options["rehypePlugins"] = [
	rehypeMathGlue,
	// Errors render inline (`.katex-error`) instead of throwing.
	[rehypeKatex, { throwOnError: false, strict: "ignore" }],
];

const components: Components = {
	pre({ children, node }) {
		const code = node?.children[0];
		const className =
			code?.type === "element" ? code.properties.className : undefined;
		if (
			Array.isArray(className) &&
			className.includes(`language-${PENDING_MATH}`)
		) {
			return <div className="math-pending">{children}</div>;
		}
		return <pre>{children}</pre>;
	},
	a({ href, children }) {
		return (
			<a href={href} target="_blank" rel="noreferrer">
				{children}
			</a>
		);
	},
};

/**
 * Renders one text block of an answer: Markdown with KaTeX math. A display
 * formula still waiting for its closing `$$` shows as raw source
 * (`.math-pending`) instead of half-rendered.
 */
export const Markdown = memo(function Markdown({
	text,
	question = false,
}: {
	text: string;
	/**
	 * The student's own text: line breaks stay line breaks, and raw HTML (such
	 * as a `<!-- comment -->`) is hidden, as in any Markdown editor.
	 */
	question?: boolean;
}) {
	return (
		<ReactMarkdown
			remarkPlugins={question ? remarkPluginsWithBreaks : remarkPlugins}
			skipHtml={question}
			rehypePlugins={rehypePlugins}
			components={components}
		>
			{normalizeMath(text)}
		</ReactMarkdown>
	);
});
