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
	page.locator(`[data-case="${id}"] .block`);

async function openFixtures(page: Page, query = "") {
	const dialogs: string[] = [];
	page.on("dialog", (d) => {
		dialogs.push(d.message());
		void d.dismiss();
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
		await expect(broken.locator(".block-error")).toContainText(
			"No se pudo dibujar",
		);
		await expect(broken.locator(".block-source")).not.toBeEmpty();
	}
	// The error names the problem.
	await expect(
		block(page, "plot-broken").locator(".block-error"),
	).toContainText("nombre desconocido «alert»");
	await expect(
		block(page, "vega-lite-broken").locator(".block-error"),
	).toContainText("no se cargan URLs");
	await expect(block(page, "dot-broken").locator(".block-source")).toHaveText(
		"digraph { a -> }",
	);
	// A block whose fence hasn't closed shows its source, not an error.
	await expect(block(page, "pending")).toHaveAttribute("data-state", "pending");
	await expect(block(page, "pending").locator(".block-source")).toContainText(
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
		block(page, "fitch-valid").locator(".block-source"),
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
		for (const el of document.querySelectorAll(".block *")) {
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
		.locator(".block")
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
				'.block[data-state="error"], .katex-error',
			).length;
			w.pending += document.querySelectorAll(
				'.block[data-state="pending"]',
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
			page.locator(`.answer .block[data-block="${kind}"]`),
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
	// 941 kB before step 6 split the renderers, KaTeX and Markdown out.
	expect(bytes).toBeLessThan(560_000);
});
