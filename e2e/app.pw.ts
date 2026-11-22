import { expect, test } from "@playwright/test";

test("the production build opens a session at its own URL", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page).toHaveTitle("Lemma");
	await expect(page).toHaveURL(/\/s\/[\w-]+$/);
	await expect(page.getByText("¿Qué estudiamos hoy?")).toBeVisible();
});

test.describe("theme", () => {
	const light = "rgb(246, 245, 241)";
	const dark = "rgb(22, 22, 20)";
	const background = (page: import("@playwright/test").Page) =>
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
