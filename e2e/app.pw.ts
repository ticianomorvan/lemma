import { existsSync } from "node:fs";
import { expect, type Page, test } from "./fixtures.ts";

test("the production build opens a session at its own URL", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page).toHaveTitle("Lemma");
	// It reopens the session used last (other tests may have made it).
	await expect(page).toHaveURL(/\/s\/[\w-]+$/);
	await expect(page.getByLabel("Mensaje")).toBeVisible();
});

test("the production build leaves out the design prototypes", async ({
	request,
}) => {
	// Dev only (vite.config.ts): the build has no prototype page and no bundle of it.
	const page = await request.get("/prototypes/read.html");
	expect(page.status()).toBe(404);
	const shell = await (await request.get("/prototypes/read")).text();
	expect(shell).not.toContain("prototipo");
	expect(existsSync("dist/prototypes")).toBe(false);
});

test("the session menu lists the folder's sessions by course and reopens one", async ({
	page,
}) => {
	const create = async (course: string, title?: string) => {
		const res = await page.request.post("/api/sessions", {
			data: { course, title },
		});
		return ((await res.json()) as { id: string }).id;
	};
	const kept = await create("logica", "Para reabrir");
	const fresh = await create("logica");
	await page.goto(`/s/${fresh}`);
	await page.getByRole("button", { name: /logica · Sin título/ }).click();
	await page.getByRole("button", { name: /Para reabrir/ }).click();
	await expect(page).toHaveURL(`/s/${kept}`);
	await expect(
		page.getByRole("button", { name: /logica · Para reabrir/ }),
	).toBeVisible();
});

test.describe("theme", () => {
	const light = "rgb(246, 245, 241)";
	const dark = "rgb(22, 22, 20)";
	const background = (page: Page) =>
		page.evaluate(() => getComputedStyle(document.body).backgroundColor);

	test("follows the system color scheme", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto("/");
		expect(await background(page)).toBe(dark);
		await page.emulateMedia({ colorScheme: "light" });
		expect(await background(page)).toBe(light);
	});

	test("data-theme overrides the system", async ({ page }) => {
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto("/");
		await page.evaluate(() =>
			document.documentElement.setAttribute("data-theme", "light"),
		);
		expect(await background(page)).toBe(light);
		await page.emulateMedia({ colorScheme: "light" });
		await page.evaluate(() =>
			document.documentElement.setAttribute("data-theme", "dark"),
		);
		expect(await background(page)).toBe(dark);
	});
});
