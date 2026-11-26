/**
 * Strips an SVG produced from model-written source (Graphviz, Mermaid, Vega,
 * Typst) down to drawing. Only SVG elements on an allow-list survive, in the
 * SVG namespace (no `<img>`, `<link>`, `<meta>` from another namespace); links
 * become plain groups; event handlers and anything that names a URL go, except
 * a `<use>` pointing at an element of the same SVG (`href="#id"`: Typst draws
 * every glyph that way); CSS
 * that could fetch (escapes, `@import`, `image-set()`, a `url()` outside the
 * document) is dropped. The server's Content-Security-Policy backs this up.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** SVG elements that only draw (lowercase). Everything else is dropped. */
const ALLOWED = new Set([
	"svg",
	"g",
	"path",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polyline",
	"polygon",
	"text",
	"tspan",
	"title",
	"desc",
	"defs",
	"marker",
	"clippath",
	"mask",
	"pattern",
	"lineargradient",
	"radialgradient",
	"stop",
	"symbol",
	"use",
	"style",
	"filter",
	"fedropshadow",
	"fegaussianblur",
	"feoffset",
	"feflood",
	"fecomposite",
	"feblend",
	"fecolormatrix",
	"femerge",
	"femergenode",
	"femorphology",
]);

/** Parses `markup` as SVG and returns the sanitized root element. */
export function parseSvg(markup: string): SVGSVGElement {
	const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
	const root = doc.documentElement;
	if (
		root.localName !== "svg" ||
		root.namespaceURI !== SVG_NS ||
		doc.querySelector("parsererror")
	) {
		throw new Error("el renderizador no devolvió un SVG válido");
	}
	return sanitizeSvg(root as unknown as SVGSVGElement);
}

/**
 * True if a piece of CSS (a `style` attribute, a `<style>` sheet, or any
 * attribute value, since presentation attributes are CSS) can't fetch.
 */
export function safeCss(css: string): boolean {
	const v = css.replace(/[\s\p{Cc}]/gu, "").toLowerCase();
	if (
		/\\|@import|@font-face|@namespace|image-set\(|image\(|cross-fade\(|element\(|src\(|expression\(|javascript:|<|paint\(/.test(
			v,
		)
	) {
		return false;
	}
	// `url(...)` may only point inside the document (`url(#clip)`).
	for (const m of v.matchAll(/url\(([^)]*)\)?/g)) {
		if (!(m[1] ?? "").replace(/['"]/g, "").startsWith("#")) return false;
	}
	return true;
}

/** A reference to an element by id: `#` and an id, nothing that can load. */
const LOCAL_REF = /^#[\w./+=:-]+$/;

export function sanitizeSvg<T extends Element>(root: T): T {
	const walk = (el: Element) => {
		for (const child of [...el.children]) {
			const name = child.localName.toLowerCase();
			if (child.namespaceURI !== SVG_NS) {
				child.remove();
				continue;
			}
			if (name === "a") {
				// Keep what a link wraps (and its position), drop the link: a <g>
				// takes its place, and its attributes go through `clean`.
				const g = el.ownerDocument.createElementNS(SVG_NS, "g");
				for (const attr of [...child.attributes]) {
					if (!attr.name.includes(":")) g.setAttribute(attr.name, attr.value);
				}
				g.append(...child.childNodes);
				child.replaceWith(g);
				walk(g);
				clean(g);
				continue;
			}
			if (!ALLOWED.has(name)) {
				child.remove();
				continue;
			}
			// A <use> may only show an element of this SVG.
			if (
				name === "use" &&
				!LOCAL_REF.test(
					child.getAttribute("href") ??
						child.getAttributeNS(XLINK_NS, "href") ??
						"",
				)
			) {
				child.remove();
				continue;
			}
			if (name === "style") {
				if (!safeCss(child.textContent ?? "")) child.remove();
				continue;
			}
			walk(child);
			clean(child);
		}
	};
	const clean = (el: Element) => {
		for (const attr of [...el.attributes]) {
			const name = attr.name.toLowerCase();
			if (
				el.localName === "use" &&
				(name === "href" || name === "xlink:href") &&
				LOCAL_REF.test(attr.value)
			) {
				continue;
			}
			if (
				name.startsWith("on") ||
				name === "href" ||
				name.endsWith(":href") ||
				name === "src" ||
				name === "srcset" ||
				name === "target" ||
				!safeCss(attr.value)
			) {
				el.removeAttribute(attr.name);
			}
		}
	};
	walk(root);
	clean(root);
	return root;
}
