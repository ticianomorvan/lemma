import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupPort } from "../playwright.config.ts";
import { expect, test } from "./fixtures.ts";

test("first run asks for the study folder, then opens a session in it", async ({
	page,
}) => {
	await page.goto(`http://127.0.0.1:${setupPort}/`);
	await expect(
		page.getByRole("heading", { name: "Elegí tu carpeta de estudio" }),
	).toBeVisible();

	const box = page.getByLabel("Carpeta");
	await box.fill("carpeta-relativa");
	await page.getByRole("button", { name: "Usar esta carpeta" }).click();
	await expect(page.getByRole("alert")).toHaveText(/ruta completa/);

	// Not under .e2e/: hidden folders are refused.
	const folder = join(
		await realpath(await mkdtemp(join(tmpdir(), "lemma-setup-"))),
		"Estudio",
	);
	await box.fill(folder);
	await page.getByRole("button", { name: "Usar esta carpeta" }).click();
	await expect(page).toHaveURL(/\/s\/[\w-]+$/);
	await expect(page.getByText("¿Qué estudiamos hoy?")).toBeVisible();

	const config = JSON.parse(
		await readFile(join(".e2e/setup/config", "config.json"), "utf8"),
	);
	expect(config.folder).toBe(folder);
});
