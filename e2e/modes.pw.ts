/**
 * Study modes on the production build: the header's mode menu sets the
 * session's mode, a second browser sees it through the `meta` event, the
 * transcript's front matter has it, and clearing it clears all three. An
 * empty session offers the modes as cards, on a phone too.
 */
import { readdirSync, readFileSync } from "node:fs";
import { expect, type Page, test } from "./fixtures.ts";

const COURSE = "modos";

/** The session's front matter `mode`, read from its `.md` in the study folder. */
function frontMatterMode(id: string) {
	const dir = `.e2e/study/${COURSE}/sessions`;
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
		const md = readFileSync(`${dir}/${file}`, "utf8");
		if (!md.includes(`id: ${id}`)) continue;
		return /^mode: (.+)$/m.exec(md.split("\n---")[0] ?? "")?.[1] ?? null;
	}
	throw new Error(`no transcript for ${id}`);
}

const modeButton = (page: Page) =>
	page.getByRole("button", { name: /^Modo de estudio/ });

test("a mode picked in one browser shows in another and in the .md, and clears", async ({
	page,
	browser,
}) => {
	const res = await page.request.post("/api/sessions", {
		data: { course: COURSE },
	});
	const { id } = (await res.json()) as { id: string };
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(`/s/${id}`);
	await expect(modeButton(page)).toHaveAccessibleName(
		"Modo de estudio: ninguno",
	);

	const other = await browser.newContext({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
	});
	const phone = await other.newPage();
	await phone.goto(`/s/${id}`);
	await expect(modeButton(phone)).toHaveAccessibleName(
		"Modo de estudio: ninguno",
	);

	await modeButton(page).click();
	const review = page.getByRole("menuitemradio", { name: /Revisar/ });
	await expect(review).toHaveAttribute("aria-checked", "false");
	await review.click();
	// Picking closes the menu.
	await expect(review).toBeHidden();
	await expect(modeButton(page)).toHaveAccessibleName(
		"Modo de estudio: Revisar",
	);
	await expect(modeButton(phone)).toHaveAccessibleName(
		"Modo de estudio: Revisar",
	);
	await expect.poll(() => frontMatterMode(id)).toBe("review");

	// The phone sees it checked in its menu, and clears it from there.
	await modeButton(phone).tap();
	await expect(
		phone.getByRole("menuitemradio", { name: /Revisar/ }),
	).toHaveAttribute("aria-checked", "true");
	await phone.getByRole("menuitemradio", { name: /Sin modo/ }).tap();
	await expect(modeButton(page)).toHaveAccessibleName(
		"Modo de estudio: ninguno",
	);
	await expect.poll(() => frontMatterMode(id)).toBeNull();
	await other.close();
});

test("an empty session offers the modes as cards", async ({ page }) => {
	const res = await page.request.post("/api/sessions", {
		data: { course: COURSE },
	});
	const { id } = (await res.json()) as { id: string };
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`/s/${id}`);
	const cards = page.getByRole("group", { name: "Elegí un modo, si querés" });
	await expect(cards.getByRole("button")).toHaveCount(4);
	const exam = cards.getByRole("button", { name: /Examen/ });
	await exam.click();
	await expect(exam).toHaveAttribute("aria-pressed", "true");
	await expect(modeButton(page)).toHaveAccessibleName(
		"Modo de estudio: Examen",
	);
	await expect.poll(() => frontMatterMode(id)).toBe("exam-prep");
	// Tapping the chosen card again clears it.
	await exam.click();
	await expect(modeButton(page)).toHaveAccessibleName(
		"Modo de estudio: ninguno",
	);
});
