/**
 * Strips an SVG produced from model-written source (Graphviz, Mermaid, Vega)
 * down to drawing: no scripts, no event handlers, no links, no embedded HTML,
 * no external references. The renderers already escape labels; this is the
 * boundary that holds if one of them doesn't.
 */

/** Elements dropped with their content. */
const SVG_NS = "http://www.w3.org/2000/svg";

const DROP = new Set([
	"script",
	"foreignobject",
	"iframe",
	"object",
	"embed",
	"audio",
	"video",
	"image",
	"use",
	"animate",
	"animatemotion",
	"animatetransform",
	"set",
	"handler",
	"listener",
]);

/** Parses `markup` as SVG and returns the sanitized root element. */
export function parseSvg(markup: string): SVGSVGElement {
	const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
	const root = doc.documentElement;
	if (root.nodeName !== "svg" || doc.querySelector("parsererror")) {
		throw new Error("el renderizador no devolvió un SVG válido");
	}
	return sanitizeSvg(root as unknown as SVGSVGElement);
}

/** True unless a `url(...)` in the value points outside the document. */
function localUrls(value: string): boolean {
	if (!value.includes("url(")) return true;
	return [...value.matchAll(/url\(([^)]*)\)?/g)].every((m) =>
		(m[1] ?? "").replace(/['"]/g, "").startsWith("#"),
	);
}

export function sanitizeSvg<T extends Element>(root: T): T {
	const walk = (el: Element) => {
		for (const child of [...el.children]) {
			const name = child.localName.toLowerCase();
			if (DROP.has(name)) {
				child.remove();
				continue;
			}
			if (name === "a") {
				// Keep what a link wraps (and its position), drop the link: a <g>
				// takes its place, and its attributes go through the check below.
				const g = el.ownerDocument.createElementNS(SVG_NS, "g");
				for (const attr of [...child.attributes]) {
					g.setAttribute(attr.name, attr.value);
				}
				g.append(...child.childNodes);
				child.replaceWith(g);
				walk(g);
				clean(g);
				continue;
			}
			walk(child);
		}
		clean(el);
	};
	const clean = (el: Element) => {
		for (const attr of [...el.attributes]) {
			const name = attr.name.toLowerCase();
			const value = attr.value.replace(/[\s\p{Cc}]/gu, "").toLowerCase();
			if (
				name.startsWith("on") ||
				name === "href" ||
				name.endsWith(":href") ||
				name === "src" ||
				name === "action" ||
				name === "formaction" ||
				name === "target" ||
				// `url(...)` may only point inside the document (`url(#clip)`).
				!localUrls(value) ||
				value.includes("javascript:") ||
				// CSS escapes (`u\72l(`) would hide a URL from the check above.
				(name === "style" && value.includes("\\"))
			) {
				el.removeAttribute(attr.name);
			}
		}
		if (el.localName === "style") {
			// Inline <style> may import or fetch; keep only self-contained rules.
			const css = el.textContent ?? "";
			if (
				/@import|expression\(|javascript:|\\/i.test(css) ||
				!localUrls(css.replace(/\s/g, "").toLowerCase())
			) {
				el.remove();
			}
		}
	};
	walk(root);
	return root;
}
