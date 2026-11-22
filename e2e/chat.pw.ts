import { expect, type Page, test } from "@playwright/test";

/** A fresh session per test, so parallel tests never share a thread. */
async function openSession(page: Page) {
	const res = await page.request.post("/api/sessions", {
		data: { course: "general" },
	});
	const { id } = (await res.json()) as { id: string };
	await page.goto(`/s/${id}`);
	await expect(page.getByText("¿Qué estudiamos hoy?")).toBeVisible();
	return id;
}

async function ask(page: Page, text: string) {
	const box = page.getByLabel("Mensaje");
	await box.fill(text);
	await box.press("Enter");
}

const stop = (page: Page) => page.getByRole("button", { name: /Detener/ });

test("a streamed math answer renders align, cases, pmatrix and inline math with no KaTeX error", async ({
	page,
}) => {
	await openSession(page);
	// Count every .katex-error that ever appears, mid-stream included.
	await page.evaluate(() => {
		const w = window as unknown as { katexErrors: number };
		w.katexErrors = 0;
		new MutationObserver(() => {
			w.katexErrors += document.querySelectorAll(".katex-error").length;
		}).observe(document.body, { childList: true, subtree: true });
	});
	await ask(page, "Resolvé el sistema $2x + y = 5$, $x - y = 1$.");

	await expect(page.getByText("Respondiendo")).toBeVisible();
	await expect(stop(page)).toBeVisible();
	await expect(stop(page)).toBeHidden({ timeout: 20_000 });

	const sources = await page
		.locator('.answer annotation[encoding="application/x-tex"]')
		.allTextContents();
	for (const env of ["align", "cases", "pmatrix"]) {
		expect(sources.some((s) => s.includes(`\\begin{${env}}`))).toBe(true);
	}
	// Inline math in the question and in the answer, with punctuation glued on.
	await expect(page.locator(".question .katex").first()).toBeVisible();
	expect(await page.locator(".answer .math-glue").count()).toBeGreaterThan(3);
	await expect(page.locator(".katex-error")).toHaveCount(0);
	await expect(page.locator(".math-pending")).toHaveCount(0);
	expect(
		await page.evaluate(
			() => (window as unknown as { katexErrors: number }).katexErrors,
		),
	).toBe(0);
});

test("stop interrupts the answer and a message sent meanwhile waits its turn", async ({
	page,
}) => {
	await openSession(page);
	await ask(page, "Primera pregunta");
	await expect(stop(page)).toBeVisible();
	await ask(page, "Segunda pregunta");
	await expect(page.getByText("En cola")).toBeVisible();

	await stop(page).click();
	await expect(page.getByText("Interrumpida")).toBeVisible();
	await expect(page.getByText("Detenida antes de terminar.")).toBeVisible();
	// The queued message starts as soon as the first turn ends.
	await expect(page.getByText("En cola")).toBeHidden();
	await expect(page.getByText("Respondiendo")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByText("Interrumpida")).toHaveCount(2);
	await expect(page.locator(".katex-error")).toHaveCount(0);
});

test("a failed turn shows the error and can be asked again", async ({
	page,
}) => {
	await openSession(page);
	await ask(page, "¿Cuánto vale la varianza?\n\n<!--fixture:error-->");
	await expect(page.getByRole("alert")).toContainText(
		"No se pudo terminar la respuesta.",
	);
	await expect(page.getByRole("alert")).toContainText("Overloaded");
	// The tag that picked the fixture is hidden from the question.
	await expect(page.getByText("fixture")).toHaveCount(0);
	await expect(page.locator(".katex-error")).toHaveCount(0);

	// Asking again resends the same text, which fails the same way here.
	await page.getByRole("button", { name: "Volver a preguntar" }).click();
	await expect(
		page.getByRole("region", { name: /¿Cuánto vale la varianza\?/ }),
	).toHaveCount(2);
});

test("two clients on one session see the same thread", async ({
	page,
	browser,
}) => {
	const id = await openSession(page);
	const other = await browser.newPage();
	await other.goto(`/s/${id}`);
	await ask(page, "Hola desde el primero");
	await expect(
		other.getByText("Hola desde el primero", { exact: true }),
	).toBeVisible();
	await expect(other.getByText("Respondiendo")).toBeVisible();
	await expect(stop(page)).toBeHidden({ timeout: 20_000 });
	await expect(other.getByText("Respondiendo")).toBeHidden();
	expect(await other.locator(".answer .katex").count()).toBe(
		await page.locator(".answer .katex").count(),
	);
	await other.close();
});

test("the index jumps to a question", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await openSession(page);
	await ask(page, "Pregunta uno");
	await expect(stop(page)).toBeHidden({ timeout: 20_000 });
	await ask(page, "Pregunta dos");
	await expect(stop(page)).toBeHidden({ timeout: 20_000 });

	const index = page.getByRole("navigation", { name: "Índice de preguntas" });
	await index.getByRole("button", { name: "Pregunta uno" }).click();
	await expect(
		page.getByRole("region", { name: /Pregunta uno/ }),
	).toBeInViewport();
	await expect(
		index.getByRole("button", { name: "Pregunta uno" }),
	).toHaveAttribute("aria-current", "true");
});

test("on a phone the index opens as a list", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await openSession(page);
	await ask(page, "Pregunta uno");
	await expect(stop(page)).toBeHidden({ timeout: 20_000 });
	await ask(page, "Pregunta dos");
	await expect(stop(page)).toBeHidden({ timeout: 20_000 });

	await page.getByRole("button", { name: "Índice de preguntas" }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: /Pregunta uno/ })
		.click();
	await expect(
		page.getByRole("region", { name: /Pregunta uno/ }),
	).toBeInViewport();
});
