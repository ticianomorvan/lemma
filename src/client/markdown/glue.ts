import type { Element, ElementContent, Root, Text } from "hast";

/** Punctuation that must stay on the line of the math it follows. */
const AFTER = /^[.,;:!?)\]}»”’…%]+/;
/** Punctuation that must stay on the line of the math it opens. */
const BEFORE = /[([{¿¡«“‘]+$/;

/**
 * A rehype plugin, run before rehype-katex: wraps each inline formula and the
 * punctuation touching it in `<span class="math-glue">` (`white-space:
 * nowrap`), so `$B$.` never wraps the period onto a line of its own.
 */
export function rehypeMathGlue() {
	return (tree: Root) => glue(tree);
}

function glue(parent: Root | Element) {
	const out: ElementContent[] = [];
	const children = parent.children as ElementContent[];
	for (let i = 0; i < children.length; i++) {
		const child = children[i] as ElementContent;
		if (child.type === "element") glue(child);
		if (!isInlineMath(child)) {
			out.push(child);
			continue;
		}
		const parts: ElementContent[] = [child];
		const prev = out.at(-1);
		if (prev?.type === "text") {
			const m = BEFORE.exec(prev.value);
			if (m) {
				prev.value = prev.value.slice(0, m.index);
				if (!prev.value) out.pop();
				parts.unshift(text(m[0]));
			}
		}
		const next = children[i + 1];
		if (next?.type === "text") {
			const m = AFTER.exec(next.value);
			if (m) {
				parts.push(text(m[0]));
				next.value = next.value.slice(m[0].length);
				if (!next.value) i++;
			}
		}
		out.push(
			parts.length === 1
				? child
				: {
						type: "element",
						tagName: "span",
						properties: { className: ["math-glue"] },
						children: parts,
					},
		);
	}
	parent.children = out as typeof parent.children;
}

function isInlineMath(node: ElementContent): node is Element {
	if (node.type !== "element" || node.tagName !== "code") return false;
	const className = node.properties.className;
	return Array.isArray(className) && className.includes("math-inline");
}

const text = (value: string): Text => ({ type: "text", value });
