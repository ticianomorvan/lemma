import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown.tsx";

/** The text deltas of a recorded stream, in order. */
function deltas(name: string): string[] {
	const url = new URL(
		`../../../test/fixtures/streams/${name}.jsonl`,
		import.meta.url,
	);
	return readFileSync(url, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line))
		.filter(
			(m) =>
				m.type === "stream_event" &&
				m.event.type === "content_block_delta" &&
				m.event.delta.type === "text_delta",
		)
		.map((m) => m.event.delta.text as string);
}

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown", () => {
	test("every streamed prefix of a math answer renders without a KaTeX error", () => {
		const chunks = deltas("math-rich");
		expect(chunks.length).toBeGreaterThan(20);
		let text = "";
		for (const chunk of chunks) {
			// Also split each chunk, so delimiters cut in half are covered.
			for (const piece of [
				chunk.slice(0, chunk.length >> 1),
				chunk.slice(chunk.length >> 1),
			]) {
				text += piece;
				const out = html(text);
				if (out.includes("katex-error")) {
					throw new Error(`KaTeX error after:\n${text}`);
				}
			}
		}
		const done = html(text);
		expect(done).not.toContain("katex-error");
		expect(done).not.toContain("math-pending");
		for (const env of ["align", "cases", "pmatrix"]) {
			expect(text).toContain(`\\begin{${env}}`);
		}
		expect(done.match(/class="katex-display"/g)?.length).toBeGreaterThan(5);
	});

	test("punctuation after inline math is glued to it", () => {
		expect(html("termina en $x=2$. Y sigue.")).toContain(
			'<span class="math-glue"><span class="katex">',
		);
		const out = html("($a$, $b$).");
		expect(out.match(/class="math-glue"/g)?.length).toBe(2);
		expect(out).toMatch(/^<p><span class="math-glue">\(<span class="katex">/);
		expect(out).toMatch(/<\/span>\)\.<\/span><\/p>$/);
	});

	test("a pending display formula shows its source", () => {
		const out = html("Sea\n\n$$\n\\frac{1}{");
		expect(out).toContain('<div class="math-pending">');
		expect(out).toContain("\\frac{1}{");
		expect(out).not.toContain("katex");
	});

	test("a question keeps its line breaks and hides HTML comments", () => {
		const out = renderToStaticMarkup(
			<Markdown
				text={"Sea $x$,\n¿cuánto vale?\n\n<!--fixture:error-->"}
				question
			/>,
		);
		expect(out).toContain("<br/>");
		expect(out).not.toContain("fixture");
	});

	test("a question with < and > keeps them as text", () => {
		const out = renderToStaticMarkup(
			<Markdown text="Probar que x<y and z>w" question />,
		);
		expect(out).toContain("x&lt;y and z&gt;w");
	});

	test("currency stays text", () => {
		const out = html("Cuesta $30 y $40.");
		expect(out).not.toContain("katex");
		expect(out).toContain("$30 y $40.");
	});
});
