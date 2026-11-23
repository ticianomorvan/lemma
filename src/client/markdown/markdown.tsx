import { memo } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMath, PENDING_MATH } from "../../shared/normalize-math.ts";
import { DiagramBlock } from "../blocks/block.tsx";
import { isBlockKind } from "../blocks/kinds.ts";
import { rehypeMathGlue } from "./glue.ts";
import { remarkOpenFence } from "./open-fence.ts";

const remarkPlugins: Options["remarkPlugins"] = [
	remarkGfm,
	[remarkMath, { singleDollarTextMath: true }],
	remarkOpenFence,
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
		if (code?.type !== "element") return <pre>{children}</pre>;
		const className = code.properties.className;
		const lang = Array.isArray(className)
			? String(className.find((c) => String(c).startsWith("language-")) ?? "")
					.slice("language-".length)
			: "";
		if (lang === PENDING_MATH) {
			return <div className="math-pending">{children}</div>;
		}
		if (isBlockKind(lang)) {
			const text = code.children[0];
			const source = text?.type === "text" ? text.value.replace(/\n$/, "") : "";
			return (
				<DiagramBlock
					kind={lang}
					source={source}
					open={code.properties.dataOpen !== undefined}
				/>
			);
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
	 * The student's own text: line breaks stay line breaks, and `<!-- comments -->`
	 * are hidden, as in any Markdown editor. Other `<…>` stays text, so `x<y`
	 * is never taken for a tag.
	 */
	question?: boolean;
}) {
	return (
		<ReactMarkdown
			remarkPlugins={question ? remarkPluginsWithBreaks : remarkPlugins}
			rehypePlugins={rehypePlugins}
			components={components}
		>
			{normalizeMath(question ? text.replace(/<!--[\s\S]*?-->/g, "") : text)}
		</ReactMarkdown>
	);
});
