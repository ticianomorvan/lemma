/**
 * The Practice view on the production build: the same thread as Read, an
 * instant switch that keeps the thread, the composer's text and each view's
 * place, and citations that open their page in a drawer. Each runs at a
 * desktop and a phone width. Its own course, with a PDF.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "./fixtures.ts";
import { NOTES, textPdf } from "./pdf.ts";

const COURSE = "practica";
const STUDY = ".e2e/study";
const PDF = `${COURSE}/materials/apunte.pdf`;
const QUOTE = "Teorema 3. Toda sucesion convergente es acotada.";

/** The fixture notes, with filler pages before the theorem so the drawer has to scroll to it. */
const PAGES = [
	NOTES[0] ?? [],
	NOTES[1] ?? [],
	["Capitulo 2b. Mas limites", "Una pagina de relleno."],
	["Capitulo 2c. Ejemplos", "Otra pagina de relleno."],
	NOTES[2] ?? [],
	NOTES[3] ?? [],
];
const PAGE = 5;

test.beforeAll(() => {
	mkdirSync(join(STUDY, COURSE, "materials"), { recursive: true });
	writeFileSync(join(STUDY, PDF), textPdf(PAGES));
});

const SIZES = [
	{ name: "desktop", width: 1280, height: 800 },
	{ name: "phone", width: 390, height: 844 },
] as const;

/** A session with an anchored question and a plain one, both answered. */
async function seeded(page: Page) {
	const res = await page.request.post("/api/sessions", {
		data: { course: COURSE },
	});
	const { id } = (await res.json()) as { id: string };
	const send = (body: object) =>
		page.request.post(`/api/sessions/${id}/messages`, {
			data: { clientMsgId: crypto.randomUUID(), ...body },
		});
	await send({
		text: "¿Por qué vale esto?",
		anchor: { path: PDF, page: PAGE, text: QUOTE },
	});
	await send({ text: "Dame un ejemplo." });
	return id;
}

/** Opens a session and counts what a reload or a refetch would show: documents and `sub` frames. */
async function open(page: Page, id: string) {
	const loads = { documents: 0, subs: 0 };
	page.on("request", (r) => {
		if (r.resourceType() === "document") loads.documents += 1;
	});
	page.on("websocket", (ws) =>
		ws.on("framesent", (f) => {
			if (typeof f.payload === "string" && f.payload.includes('"t":"sub"'))
				loads.subs += 1;
		}),
	);
	await page.goto(`/s/${id}`);
	// Two answered questions.
	await expect(page.getByLabel("Mensaje")).toBeAttached();
	return loads;
}

const cells = (page: Page) =>
	page.locator('section[id^="turn-"]').evaluateAll((els) =>
		els.map((el) => ({
			id: el.id,
			text: el.textContent,
		})),
	);

for (const size of SIZES) {
	test.describe(size.name, () => {
		test.use({ viewport: { width: size.width, height: size.height } });

		test("switching views keeps the thread, the draft and each view's place, with no reload or refetch", async ({
			page,
		}) => {
			const id = await seeded(page);
			// Practice first, to wait for the answers to finish.
			await page.goto(`/s/${id}`);
			await page.keyboard.press("Alt+Digit2");
			await expect(page.locator('section[id^="turn-"]')).toHaveCount(2, {
				timeout: 15_000,
			});
			await expect(page.getByText("Respondiendo")).toHaveCount(0, {
				timeout: 15_000,
			});

			const loads = await open(page, id);
			await expect(
				page.getByRole("tab", { name: "Practicar" }),
			).toHaveAttribute("aria-selected", "true");
			await page.evaluate(() => {
				(window as { marker?: number }).marker = 1;
			});
			const before = await cells(page);
			expect(before).toHaveLength(2);

			// The draft, and a place in the notebook away from the bottom.
			await page.getByLabel("Mensaje").fill("una pregunta a medio escribir");
			const notebook = page.locator('section[id^="turn-"]').first();
			await notebook.evaluate((el) => {
				const scroller = el.closest(".overflow-y-auto") as HTMLElement;
				scroller.scrollTop = 120;
				scroller.dispatchEvent(new Event("scroll"));
			});
			await page.waitForTimeout(100);
			const scrolled = await notebook.evaluate(
				(el) => (el.closest(".overflow-y-auto") as HTMLElement).scrollTop,
			);

			// To Read: the PDF, the thread in its chat with the same draft.
			await page.keyboard.press("Alt+Digit1");
			await expect(page.locator("[data-pdf]")).toBeVisible();
			await page
				.locator('[data-page="3"]')
				.evaluate((el) => el.scrollIntoView({ block: "start" }));
			await expect(page.getByText("apunte.pdf · p. 3 de")).toBeVisible();
			await page.getByRole("button", { name: /^Chat/ }).first().click();
			const chat = page.getByRole("region", { name: "Chat" });
			await expect(chat.getByLabel("Mensaje")).toHaveValue(
				"una pregunta a medio escribir",
			);
			expect(await cells(page)).toEqual(before);

			// Back to Practice: the same thread, draft and place. (A phone's
			// chat is a sheet over the header; close it first.)
			if (size.name === "phone") await page.keyboard.press("Escape");
			await page.getByRole("tab", { name: "Practicar" }).click();
			await expect(page.locator("[data-pdf]")).toHaveCount(0);
			await expect(page.getByLabel("Mensaje")).toHaveValue(
				"una pregunta a medio escribir",
			);
			expect(await cells(page)).toEqual(before);
			const back = await page
				.locator('section[id^="turn-"]')
				.first()
				.evaluate(
					(el) => (el.closest(".overflow-y-auto") as HTMLElement).scrollTop,
				);
			expect(Math.abs(back - scrolled)).toBeLessThan(4);

			// And Read again: the same page of the PDF.
			await page.keyboard.press("Alt+Digit1");
			await expect(page.getByText("apunte.pdf · p. 3 de")).toBeVisible();

			// No navigation, no new document, no re-subscription.
			expect(
				await page.evaluate(() => (window as { marker?: number }).marker),
			).toBe(1);
			expect(loads).toEqual({ documents: 1, subs: 1 });
		});

		test("a citation opens the drawer at its page with the passage highlighted", async ({
			page,
		}) => {
			const violations: string[] = [];
			page.on("console", (m) => {
				if (/content security policy/i.test(m.text()))
					violations.push(m.text());
			});
			const id = await seeded(page);
			await page.goto(`/s/${id}`);
			await page.keyboard.press("Alt+Digit2");
			await page
				.getByRole("button", { name: `Abrir apunte.pdf en la página ${PAGE}` })
				.click();

			const drawer = page.getByRole("dialog", {
				name: `apunte.pdf · p. ${PAGE} de ${PAGES.length}`,
			});
			await expect(drawer).toBeVisible({ timeout: 15_000 });
			// From the right on a desktop, from the bottom on a phone.
			await drawer.evaluate((el) =>
				Promise.all(el.getAnimations().map((a) => a.finished)),
			);
			const box = await drawer.boundingBox();
			if (size.name === "phone") {
				expect(box?.width).toBe(size.width);
				expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(size.height, 0);
			} else {
				expect((box?.x ?? 0) + (box?.width ?? 0)).toBeCloseTo(size.width, 0);
				expect(box?.width).toBeLessThan(size.width);
			}

			// The quoted passage is painted as the active one, on screen in the drawer.
			await expect
				.poll(() =>
					page.evaluate(() => {
						const highlight = CSS.highlights.get("lemma-active");
						const range = highlight && [...highlight][0];
						if (!(range instanceof Range)) return null;
						const page = range.startContainer.parentElement?.closest(
							"[data-page]",
						) as HTMLElement | null;
						const r = range.getBoundingClientRect();
						const s = document
							.querySelector("[data-pdf-scroller]")
							?.getBoundingClientRect();
						return {
							page: page?.dataset.page,
							text: range.toString().replace(/\s+/g, " "),
							inView: !!s && r.top >= s.top && r.bottom <= s.bottom,
						};
					}),
				)
				.toEqual({ page: String(PAGE), text: QUOTE, inView: true });

			// "Abrir en Leer" opens Read on that page.
			await drawer.getByRole("button", { name: "Abrir en Leer" }).click();
			await expect(page.locator("[data-pdf]")).toBeVisible();
			await expect(page.getByText(`apunte.pdf · p. ${PAGE} de`)).toBeVisible();
			expect(violations).toEqual([]);
		});
	});
}

test("a session whose course has no PDFs stays in Practice", async ({
	page,
}) => {
	const res = await page.request.post("/api/sessions", {
		data: { course: "sin-apuntes" },
	});
	const { id } = (await res.json()) as { id: string };
	await page.goto(`/s/${id}`);
	await expect(page.getByLabel("Mensaje")).toBeVisible();
	const read = page.getByRole("tab", { name: "Leer" });
	await expect(read).toBeDisabled();
	await page.keyboard.press("Alt+Digit1");
	await expect(page.getByRole("tab", { name: "Practicar" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.locator("[data-pdf]")).toHaveCount(0);
});
