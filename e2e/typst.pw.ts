/**
 * Typst on the production build (step 12): a `.typ` note opens in Read as a
 * compiled document and follows edits on disk, a broken one says why, and
 * "Exportar" writes the session as `.typ` and PDF. Its own course, so other
 * tests' sessions keep opening in Practice.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "./fixtures.ts";

const COURSE = "logica";
const STUDY = ".e2e/study";
const NOTES = join(STUDY, COURSE, "notes");

test.beforeAll(() => {
	mkdirSync(NOTES, { recursive: true });
	writeFileSync(join(NOTES, "comun.typ"), "#let clave = [*Modus ponens*]");
	writeFileSync(
		join(NOTES, "resumen.typ"),
		'#import "comun.typ": clave\n= Resumen de lógica\n#clave: de $p$ y $p -> q$ se sigue $q$.',
	);
	writeFileSync(join(NOTES, "roto.typ"), "= Roto\n$ x^2 +");
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

const textLayer = (page: Page) => page.locator(".textLayer").first();

async function openFile(page: Page, name: string) {
	await page.getByRole("button", { name: /Cambiar de apunte/ }).click();
	await page.getByRole("button", { name }).click();
}

test("a .typ note opens in Read, compiled, and follows edits on disk", async ({
	page,
}) => {
	const { violations } = await openSession(page);
	await page.getByRole("tab", { name: "Leer" }).click();
	await openFile(page, "resumen.typ");
	await expect(page.getByText(/resumen\.typ · p\. 1 de 1/)).toBeVisible({
		timeout: 15_000,
	});
	await expect(textLayer(page)).toContainText("Resumen de lógica", {
		timeout: 15_000,
	});
	await expect(textLayer(page)).toContainText("Modus ponens");

	// Claude (or an editor) changes the note: the page shows the new text.
	writeFileSync(
		join(NOTES, "resumen.typ"),
		'#import "comun.typ": clave\n= Resumen de lógica, segunda versión\n#clave.',
	);
	await expect(textLayer(page)).toContainText("segunda versión", {
		timeout: 15_000,
	});
	expect(violations).toEqual([]);
});

test("a .typ note that doesn't compile says why", async ({ page }) => {
	await openSession(page);
	await page.getByRole("tab", { name: "Leer" }).click();
	await openFile(page, "roto.typ");
	const alert = page.getByRole("alert").filter({ hasText: "Typst" });
	await expect(alert).toContainText(
		"No se pudo compilar este archivo de Typst",
		{
			timeout: 15_000,
		},
	);
	await expect(alert).toContainText("roto.typ, línea 2: unclosed delimiter");
});

test("Exportar writes the session as Typst and PDF", async ({ page }) => {
	const { id, violations } = await openSession(page);
	await page.getByRole("tab", { name: "Practicar" }).click();
	const box = page.getByLabel("Mensaje");
	await box.fill("AFD, deducción natural y normal\n\n<!--fixture:diagrams-->");
	await box.press("Enter");
	// The answer is in (and so in the transcript) once its last block is drawn.
	await expect(
		page.locator('.answer .diagram[data-block="plot"]'),
	).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
	await expect(page.getByRole("button", { name: /Detener/ })).toBeHidden({
		timeout: 30_000,
	});

	await page.getByRole("button", { name: "Exportar" }).click();
	await page.getByRole("button", { name: "Exportar a Typst y PDF" }).click();
	const link = page.getByRole("link", { name: /\.pdf/ });
	await expect(link).toBeVisible({ timeout: 20_000 });
	const href = (await link.getAttribute("href")) ?? "";
	expect(href).toMatch(new RegExp(`^/files/${COURSE}/exports/.+\\.pdf$`));
	const pdf = await page.request.get(href);
	expect(pdf.status()).toBe(200);
	expect(pdf.headers()["content-type"]).toBe("application/pdf");

	const typ = join(
		STUDY,
		decodeURIComponent(href.slice("/files/".length)),
	).replace(/\.pdf$/, ".typ");
	expect(existsSync(typ)).toBe(true);
	const source = readFileSync(typ, "utf8");
	expect(source).toContain('#import "@preview/mitex:0.2.7"');
	expect(source).toContain("AFD, deducción natural y normal");
	// The recorded answer's automaton went in drawn by Graphviz.
	expect(source).toContain('image(bytes("<?xml');
	expect(id).toBeTruthy();
	expect(violations).toEqual([]);
});
