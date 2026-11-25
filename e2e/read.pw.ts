/**
 * The Read view on the production build: a course PDF from `materials/`,
 * select → Ask and Note, margin cards, pins, the phone strip, and the switch
 * to Practice. Its own course, so other tests' sessions keep opening in
 * Practice (their courses have no PDFs).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "./fixtures.ts";
import { NOTES, textPdf } from "./pdf.ts";

const COURSE = "analisis";
const STUDY = ".e2e/study";
const PDF = `${COURSE}/materials/apunte.pdf`;

test.beforeAll(() => {
	mkdirSync(join(STUDY, COURSE, "materials"), { recursive: true });
	writeFileSync(join(STUDY, PDF), textPdf(NOTES));
});

async function openSession(page: Page) {
	const violations: string[] = [];
	page.on("console", (m) => {
		if (/content security policy/i.test(m.text())) violations.push(m.text());
	});
	const res = await page.request.post("/api/sessions", {
		data: { course: COURSE },
	});
	const { id } = (await res.json()) as { id: string };
	await page.goto(`/s/${id}`);
	return { id, violations };
}

/** Scrolls to a page, waits for its text layer, and selects `text` in it. */
async function select(page: Page, n: number, text: string) {
	const pdfPage = page.locator(`[data-page="${n}"]`);
	await pdfPage.scrollIntoViewIfNeeded();
	const span = pdfPage.locator(".textLayer span", { hasText: text }).first();
	await expect(span).toBeAttached({ timeout: 15_000 });
	await span.evaluate((el, wanted) => {
		const node = el.firstChild as Text;
		const start = node.data.indexOf(wanted);
		const range = document.createRange();
		range.setStart(node, start);
		range.setEnd(node, start + wanted.length);
		const sel = getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}, text);
}

const sessionFile = (id: string) => {
	const dir = join(STUDY, COURSE, "sessions");
	for (const name of readdirSync(dir)) {
		const md = readFileSync(join(dir, name), "utf8");
		if (md.includes(`id: ${id}`)) return md;
	}
	throw new Error(`no transcript for ${id}`);
};

const highlights = (page: Page, name: string) =>
	page.evaluate((n) => CSS.highlights.get(n)?.size ?? 0, name);

test("selecting text on page 3 and asking sends an anchor with page 3", async ({
	page,
}) => {
	const { id, violations } = await openSession(page);
	await expect(page.getByRole("tab", { name: "Leer" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await select(page, 3, "Teorema 3. Toda sucesion convergente es acotada.");
	const ask = page.waitForRequest(
		(r) => r.method() === "POST" && r.url().endsWith(`/${id}/messages`),
	);
	await page
		.getByRole("toolbar", { name: "Selección" })
		.getByRole("button", { name: "Preguntar" })
		.click();
	// With the chat closed, the question is drafted in the margin.
	await page.getByLabel("Pregunta", { exact: true }).fill("explicá esto");
	await page.getByRole("button", { name: "Preguntar", exact: true }).click();

	const body = (await ask).postDataJSON() as {
		text: string;
		anchor: { path: string; page: number; text: string };
	};
	expect(body.text).toBe("explicá esto");
	expect(body.anchor).toEqual({
		path: PDF,
		page: 3,
		text: "Teorema 3. Toda sucesion convergente es acotada.",
	});

	// One card beside the passage, and the passage painted.
	const margin = page.getByRole("region", { name: /Margen/ });
	await expect(margin.getByText("explicá esto")).toBeVisible();
	await expect.poll(() => highlights(page, "lemma-question")).toBe(1);

	// Opening the chat folds the card into a pin that scrolls the panel.
	await page.getByRole("button", { name: /^Chat/ }).click();
	await page.getByRole("button", { name: "Ir a la pregunta 1" }).click();
	await expect(
		page.getByRole("region", { name: /Pregunta: explicá esto/ }),
	).toBeFocused();

	expect(sessionFile(id)).toContain(
		"## Tú\n\n> [apunte.pdf, p. 3](../../analisis/materials/apunte.pdf#page=3)\n> Teorema 3.",
	);
	expect(violations).toEqual([]);
});

test("a note shows as a card and lands in the .md as a `> [!note]`", async ({
	page,
}) => {
	const { id, violations } = await openSession(page);
	await select(page, 3, "Demostracion. Tomemos epsilon = 1");
	await page
		.getByRole("toolbar", { name: "Selección" })
		.getByRole("button", { name: "Nota" })
		.click();
	await page
		.getByLabel("Nota", { exact: true })
		.fill("repasar para el parcial");
	await page.getByRole("button", { name: "Guardar", exact: true }).click();

	const margin = page.getByRole("region", { name: /Margen/ });
	await expect(margin.getByText("repasar para el parcial")).toBeVisible();
	await expect.poll(() => highlights(page, "lemma-note")).toBe(1);
	await expect
		.poll(() => sessionFile(id))
		.toContain(
			[
				"## Nota",
				"",
				"> [!note] [apunte.pdf, p. 3](../../analisis/materials/apunte.pdf#page=3)",
				"> > Demostracion. Tomemos epsilon = 1",
				">",
				"> repasar para el parcial",
			].join("\n"),
		);
	expect(violations).toEqual([]);
});

test("⌥2 and ⌥1 switch to Practice and back without a reload", async ({
	page,
}) => {
	await openSession(page);
	await expect(page.locator("[data-page]").first()).toBeVisible();
	await page.evaluate(() => {
		(window as { marker?: number }).marker = 1;
	});
	await page.keyboard.press("Alt+Digit2");
	await expect(page.getByLabel("Mensaje")).toBeVisible();
	await expect(page.locator("[data-pdf]")).toHaveCount(0);
	await page.keyboard.press("Alt+Digit1");
	await expect(page.locator("[data-pdf]")).toBeVisible();
	expect(
		await page.evaluate(() => (window as { marker?: number }).marker),
	).toBe(1);
});

test("on a phone, the visible page's cards sit in a strip and the chat is a sheet", async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { id } = await openSession(page);
	await page.request.post(`/api/sessions/${id}/notes`, {
		data: {
			anchor: { path: PDF, page: 1, text: "Una sucesion es una funcion" },
			text: "definición",
		},
	});
	await expect(page.getByText("p. 1 · 1 en esta página")).toBeVisible({
		timeout: 15_000,
	});
	await page.getByRole("button", { name: /^Chat · / }).click();
	await expect(page.getByRole("dialog", { name: "Chat" })).toBeVisible();
	await expect(page.getByLabel("Mensaje")).toBeVisible();
});

test("a selection that runs onto the next page quotes only the first page", async ({
	page,
}) => {
	const { id } = await openSession(page);
	await page.locator('[data-page="4"]').scrollIntoViewIfNeeded();
	await expect(
		page.locator('[data-page="4"] .textLayer span', { hasText: "Ejercicio 1" }),
	).toBeAttached({ timeout: 15_000 });
	await page.locator('[data-page="3"]').scrollIntoViewIfNeeded();
	const line = page.locator('[data-page="3"] .textLayer span', {
		hasText: "Entonces",
	});
	await expect(line).toBeAttached({ timeout: 15_000 });
	await line.scrollIntoViewIfNeeded();
	await page.evaluate(() => {
		const span = (n: number, text: string) =>
			[...document.querySelectorAll(`[data-page="${n}"] .textLayer span`)].find(
				(s) => s.textContent?.includes(text),
			)?.firstChild as Text;
		const range = document.createRange();
		range.setStart(span(3, "Entonces"), 0);
		range.setEnd(span(4, "Capitulo 4"), 8);
		getSelection()?.removeAllRanges();
		getSelection()?.addRange(range);
	});
	const noted = page.waitForRequest((r) => r.url().endsWith(`/${id}/notes`));
	await page
		.getByRole("toolbar", { name: "Selección" })
		.getByRole("button", { name: "Nota" })
		.click();
	await page.getByRole("button", { name: "Guardar", exact: true }).click();
	const { anchor } = (await noted).postDataJSON() as {
		anchor: { page: number; text: string };
	};
	expect(anchor).toEqual({
		path: PDF,
		page: 3,
		text: "Entonces |a_n| < |L| + 1 para todo n > N.",
	});
});
