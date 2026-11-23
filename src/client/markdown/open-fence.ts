import type { Code, Nodes, Root } from "mdast";


/**
 * A remark plugin: marks each fenced code block whose closing fence hasn't
 * arrived (`data-open` on its `<code>`), so a diagram still streaming in
 * shows its source instead of a parse error. remark runs an unclosed fence
 * to the end of the text, so only the last block can be open.
 */
export function remarkOpenFence() {
	return (tree: Root, file: { value: unknown }) => {
		const text = String(file.value);
		const visit = (node: Nodes) => {
			if (node.type === "code") mark(node, text);
			else if ("children" in node) for (const c of node.children) visit(c);
		};
		visit(tree);
	};
}

function mark(node: Code, text: string) {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;
	if (start === undefined || end === undefined) return;
	const raw = text.slice(start, end);
	const open = /^[ \t>]*([`~]{3,})/.exec(raw)?.[1];
	if (!open) return; // indented code has no fence
	const lines = raw.split("\n");
	const last = lines.length > 1 ? (lines.at(-1) ?? "") : "";
	const closing = /^[ \t>]*([`~]+)[ \t]*$/.exec(last)?.[1];
	const closed =
		closing !== undefined &&
		closing[0] === open[0] &&
		closing.length >= open.length;
	if (!closed) {
		node.data = {
			...node.data,
			hProperties: { ...node.data?.hProperties, dataOpen: "" },
		};
	}
}
