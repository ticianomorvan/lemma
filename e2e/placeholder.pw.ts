import { expect, test } from "@playwright/test";

test("production build serves the placeholder page", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveTitle("Lemma");
	await expect(page.getByRole("heading", { name: "Lemma" })).toBeVisible();
});
