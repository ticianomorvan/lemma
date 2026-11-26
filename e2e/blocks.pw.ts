import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "./fixtures.ts";

const KINDS = [
	"dot",
	"proof",
	"fitch",
	"plot",
	"vega-lite",
	"mermaid",
] as const;
/** What a rendered block of each kind has in its body. */
const BODY: Record<(typeof KINDS)[number], string> = {
	dot: ".dot svg g.node",
	proof: ".pt-line",
	fitch: ".fk-row",
	plot: ".plot-svg svg path",
	"vega-lite": ".vega svg",
	mermaid: ".mermaid svg",
};

const block = (page: Page, id: string) =>
	page.locator(`[data-case="${id}"] .diagram`);

/** Opens the fixture page; the list collects any dialog or CSP violation. */
async function openFixtures(page: Page, query = "") {
	const dialogs: string[] = [];
	page.on("dialog", (d) => {
		dialogs.push(d.message());
		void d.dismiss();
	});
	page.on("console", (m) => {
		if (/content security policy/i.test(m.text())) dialogs.push(m.text());
	});
	await page.goto(`/fixtures/blocks.html${query}`);
	return dialogs;
}

test("each valid block renders, and each broken one shows its source and the error", async ({
	page,
}) => {
	const dialogs = await openFixtures(page);
	for (const kind of KINDS) {
		const valid = block(page, `${kind}-valid`);
		await expect(valid).toHaveAttribute("data-state", "ok", {
			timeout: 15_000,
		});
		await expect(valid.locator(BODY[kind]).first()).toBeVisible();

		const broken = block(page, `${kind}-broken`);
		await expect(broken).toHaveAttribute("data-state", "error", {
			timeout: 15_000,
		});
		await expect(broken.locator(".diagram-error")).toContainText(
			"No se pudo dibujar",
		);
		await expect(broken.locator(".diagram-source")).not.toBeEmpty();
	}
	// The error names the problem.
	await expect(
		block(page, "plot-broken").locator(".diagram-error"),
	).toContainText("nombre desconocido «alert»");
	await expect(
		block(page, "vega-lite-broken").locator(".diagram-error"),
	).toContainText("no se cargan URLs");
	await expect(block(page, "dot-broken").locator(".diagram-source")).toHaveText(
		"digraph { a -> }",
	);
	// tan(x) on [-4, 4] has poles at ±π/2: three branches, not one joined line.
	const tan = await block(page, "plot-poles")
		.locator(".plot-svg svg path")
		.getAttribute("d");
	expect(tan?.match(/M/g)?.length).toBe(3);
	// A block whose fence hasn't closed shows its source, not an error.
	await expect(block(page, "pending")).toHaveAttribute("data-state", "pending");
	await expect(block(page, "pending").locator(".diagram-source")).toContainText(
		'"xDomain"',
	);
	// The proof's discharged assumption and its rule light up together.
	const proof = block(page, "proof-valid");
	await proof.locator(".pt-leaf[data-discharged]").first().hover();
	await expect(proof.locator("[data-hot]")).toHaveCount(2);
	// Source on demand.
	await block(page, "fitch-valid")
		.getByRole("button", { name: "Fuente" })
		.click();
	await expect(
		block(page, "fitch-valid").locator(".diagram-source"),
	).toContainText('"lines"');
	expect(dialogs).toEqual([]);
});

test("links and handlers in model-written diagrams are stripped", async ({
	page,
}) => {
	const dialogs = await openFixtures(page);
	for (const id of ["dot-link", "mermaid-click"]) {
		await expect(block(page, id)).toHaveAttribute("data-state", "ok", {
			timeout: 15_000,
		});
	}
	await expect(block(page, "mermaid-click")).toContainText("Inicio");
	const unsafe = await page.evaluate(() => {
		const found: string[] = [];
		for (const el of document.querySelectorAll(".diagram *")) {
			if (el.localName === "a" || el.localName === "foreignObject") {
				found.push(el.localName);
			}
			for (const a of el.attributes) {
				if (/^on|href$/i.test(a.name) || /javascript:/i.test(a.value)) {
					found.push(`${el.localName}[${a.name}]`);
				}
			}
		}
		return found;
	});
	expect(unsafe).toEqual([]);
	await block(page, "mermaid-click").getByText("Inicio").click();
	expect(dialogs).toEqual([]);
});

test("blocks that bring their own config or generate data are refused", async ({
	page,
}) => {
	await openFixtures(page);
	for (const [id, message] of [
		["mermaid-init", "directivas"],
		["vega-sequence", "sequence"],
	] as const) {
		await expect(block(page, id)).toHaveAttribute("data-state", "error", {
			timeout: 15_000,
		});
		await expect(block(page, id).locator(".diagram-error")).toContainText(
			message,
		);
	}
});

test("the sanitizer keeps drawing and drops anything that could fetch or run", async ({
	page,
}) => {
	await openFixtures(page);
	const svg = (body: string) =>
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:h="http://www.w3.org/1999/xhtml">${body}</svg>`;
	const probe = (body: string) =>
		page.evaluate(
			(m) =>
				(
					window as unknown as { sanitizeProbe: (m: string) => string }
				).sanitizeProbe(m),
			svg(body),
		);
	const out = await probe(
		[
			'<rect width="10" height="10" fill="url(#g)" clip-path="url(#c)"/>',
			"<rect style=\"fill: image-set('https://example.com/a.png' 1x)\"/>",
			'<rect style="fill: u\\72l(https://example.com/b)"/>',
			'<rect fill="url(https://example.com/c)"/>',
			"<style>@import 'https://example.com/d.css'; rect { fill: red }</style>",
			"<style>@keyframes spin { to { opacity: 1 } }</style>",
			'<h:img src="https://example.com/e.png"/>',
			'<h:meta http-equiv="refresh" content="0;url=https://example.com/f"/>',
			'<image href="https://example.com/g.png"/>',
			'<use xlink:href="https://example.com/h.svg#x"/>',
			"<foreignObject><h:div>x</h:div></foreignObject>",
			"<script>alert(1)</script>",
			'<a href="javascript:alert(1)" transform="translate(5,5)"><text>t</text></a>',
			'<animate attributeName="href" to="javascript:alert(1)"/>',
			'<g onclick="alert(1)"><circle r="1"/></g>',
		].join(""),
	);
	expect(out).toContain('fill="url(#g)"');
	expect(out).toContain('clip-path="url(#c)"');
	expect(out).toContain("@keyframes");
	expect(out).toContain('<g transform="translate(5,5)"><text>t</text></g>');
	expect(out).toContain('<circle r="1"');
	for (const bad of [
		"example.com",
		"image-set",
		"\\",
		"<img",
		"<meta",
		"<image",
		"<use",
		"<foreignObject",
		"<script",
		"<a ",
		"<animate",
		"onclick",
		"javascript:",
	]) {
		expect(out).not.toContain(bad);
	}
});

test("blocks fit a phone and follow dark mode", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openFixtures(page, "?theme=dark");
	for (const kind of KINDS) {
		await expect(block(page, `${kind}-valid`)).toHaveAttribute(
			"data-state",
			"ok",
			{
				timeout: 15_000,
			},
		);
	}
	// Nothing widens the page; wide diagrams scroll inside their card.
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
		390,
	);
	const right = await page
		.locator(".diagram")
		.evaluateAll((els) =>
			Math.max(...els.map((e) => e.getBoundingClientRect().right)),
		);
	expect(right).toBeLessThanOrEqual(390);
	// Graphviz's default black ink takes the dark theme's foreground.
	const ink = await block(page, "dot-valid")
		.locator(".dot svg g.node text")
		.first()
		.evaluate((t) => getComputedStyle(t).fill);
	expect(ink).toBe("rgb(236, 235, 230)");
});

test("a streamed answer with diagrams never flashes an error", async ({
	page,
}) => {
	const res = await page.request.post("/api/sessions", {
		data: { course: "general" },
	});
	const { id } = (await res.json()) as { id: string };
	await page.goto(`/s/${id}`);
	await expect(page.getByText("¿Qué estudiamos hoy?")).toBeVisible();
	await page.evaluate(() => {
		const w = window as unknown as { blockErrors: number; pending: number };
		w.blockErrors = 0;
		w.pending = 0;
		new MutationObserver(() => {
			w.blockErrors += document.querySelectorAll(
				'.diagram[data-state="error"], .katex-error',
			).length;
			w.pending += document.querySelectorAll(
				'.diagram[data-state="pending"]',
			).length;
		}).observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
		});
	});
	const box = page.getByLabel("Mensaje");
	await box.fill("AFD, deducción natural y normal\n\n<!--fixture:diagrams-->");
	await box.press("Enter");
	await expect(page.getByRole("button", { name: /Detener/ })).toBeHidden({
		timeout: 30_000,
	});
	for (const kind of ["dot", "proof", "plot"]) {
		await expect(
			page.locator(`.answer .diagram[data-block="${kind}"]`),
		).toHaveAttribute("data-state", "ok", { timeout: 15_000 });
	}
	const seen = await page.evaluate(() => {
		const w = window as unknown as { blockErrors: number; pending: number };
		return { blockErrors: w.blockErrors, pending: w.pending };
	});
	expect(seen.blockErrors).toBe(0);
	// The blocks were shown as source while they streamed in.
	expect(seen.pending).toBeGreaterThan(0);
});

test("the app's first load stays small: diagram renderers load on demand", () => {
	const dist = join(import.meta.dirname, "..", "dist");
	const html = readFileSync(join(dist, "index.html"), "utf8");
	const scripts = [
		...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g),
	].map((m) => m[1] as string);
	const bytes = scripts.reduce(
		(sum, s) => sum + statSync(join(dist, s)).size,
		0,
	);
	// 941 kB before step 6 split the renderers, KaTeX and Markdown out;
	// 557 kB after step 10. Step 11's mode cards add 5 kB (its menu, Base
	// UI's Menu, is a lazy chunk). Step 12's print copy adds 5 kB (568 kB).
	// Step 13 adds 0.7 kB (569 kB): the "not running" screen and the call that
	// loads the service worker's own chunk after load.
	expect(bytes).toBeLessThan(570_000);
});
