/**
 * Photos from a phone on the production build: the camera input, the
 * downscale before upload, the photo arriving in a second browser, and the
 * photo going out with the next message. The phone is a 390 px touch
 * context; the LAN itself is covered by src/server/phone.test.ts.
 */
import { expect, type Page, test } from "./fixtures.ts";

const COURSE = "fotos";

/** A 4032×3024 camera-sized JPEG, drawn at runtime (no binary fixture). */
async function cameraPhoto(page: Page) {
	const base64 = await page.evaluate(async () => {
		const canvas = document.createElement("canvas");
		canvas.width = 4032;
		canvas.height = 3024;
		const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
		ctx.fillStyle = "#f4f1e8";
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.fillStyle = "#1a1a1a";
		ctx.font = "220px serif";
		ctx.fillText("x² − 5x + 6 = 0", 300, 1200);
		ctx.fillText("(x − 2)(x − 3) = 0", 300, 1800);
		const blob = await new Promise<Blob>((resolve) =>
			canvas.toBlob((b) => resolve(b as Blob), "image/jpeg", 0.95),
		);
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let binary = "";
		for (const b of bytes) binary += String.fromCharCode(b);
		return btoa(binary);
	});
	return {
		name: "IMG_0001.jpg",
		mimeType: "image/jpeg",
		buffer: Buffer.from(base64, "base64"),
	};
}

const size = (page: Page, name: string) =>
	page
		.getByRole("img", { name })
		.evaluate((img: HTMLImageElement) =>
			img.complete && img.naturalWidth > 0
				? [img.naturalWidth, img.naturalHeight]
				: null,
		);

test("a phone's photo is downscaled, shows on every client, and goes out with the next message", async ({
	page,
	browser,
}) => {
	const res = await page.request.post("/api/sessions", {
		data: { course: COURSE },
	});
	const { id } = (await res.json()) as { id: string };
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto(`/s/${id}`);
	await expect(page.getByLabel("Mensaje")).toBeVisible();

	const phoneContext = await browser.newContext({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	});
	const phone = await phoneContext.newPage();
	const errors: string[] = [];
	phone.on("pageerror", (e) => errors.push(e.message));
	await phone.goto(`/s/${id}`);

	// An empty notebook on a phone leads with the camera.
	const hero = phone.getByRole("button", { name: "Sacar foto del ejercicio" });
	await expect(hero).toBeVisible();
	const input = phone.locator("[data-camera]").first();
	await expect(input).toHaveAttribute("capture", "environment");
	await expect(input).toHaveAttribute("accept", "image/*");

	const photo = await cameraPhoto(phone);
	expect(photo.buffer.length).toBeGreaterThan(100_000);
	const uploaded = phone.waitForResponse(
		(r) =>
			r.url().endsWith(`/api/sessions/${id}/attachments`) &&
			r.request().method() === "POST",
	);
	await input.setInputFiles(photo);
	const response = await uploaded;
	expect(response.status()).toBe(201);
	expect(response.request().headers()["content-type"]).toContain(
		"multipart/form-data",
	);

	// The stored photo: long edge 2048, the camera's 4:3 kept.
	await expect.poll(() => size(phone, "Foto 1")).toEqual([2048, 1536]);
	await expect(phone.getByRole("button", { name: "Sacar otra" })).toBeVisible();
	await expect(hero).toBeHidden();

	// The desktop sees it arrive without a reload.
	await expect.poll(() => size(page, "Foto 1")).toEqual([2048, 1536]);

	// Sent from the desktop with a comment; the question carries the photo.
	const box = page.getByRole("textbox", { name: "Mensaje" });
	await expect(box).toHaveAttribute("placeholder", "Agregá un comentario…");
	await box.fill("¿Está bien?");
	await box.press("Enter");
	for (const p of [page, phone]) {
		await expect(
			p.getByRole("img", { name: "Foto 1 de la pregunta" }),
		).toBeVisible();
		await expect(
			p.getByRole("list", { name: "Fotos por enviar" }),
		).toBeHidden();
	}
	expect(errors).toEqual([]);
	await phoneContext.close();
});

test("a removed photo leaves every client", async ({ page, browser }) => {
	const res = await page.request.post("/api/sessions", {
		data: { course: COURSE },
	});
	const { id } = (await res.json()) as { id: string };
	await page.goto(`/s/${id}`);
	const phoneContext = await browser.newContext({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	});
	const phone = await phoneContext.newPage();
	await phone.goto(`/s/${id}`);
	await phone
		.locator("[data-camera]")
		.first()
		.setInputFiles(await cameraPhoto(phone));
	await expect(page.getByRole("img", { name: "Foto 1" })).toBeVisible();
	await phone.getByRole("button", { name: "Quitar la foto 1" }).tap();
	await expect(page.getByRole("img", { name: "Foto 1" })).toBeHidden();
	await expect(phone.getByRole("img", { name: "Foto 1" })).toBeHidden();
	await phoneContext.close();
});

test("on a phone, a tap explains why Leer is off", async ({ browser }) => {
	const context = await browser.newContext({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
	});
	const phone = await context.newPage();
	const res = await phone.request.post("/api/sessions", {
		data: { course: COURSE },
	});
	const { id } = (await res.json()) as { id: string };
	await phone.goto(`/s/${id}`);
	await phone
		.getByRole("button", { name: /Leer: este curso no tiene apuntes/ })
		.tap();
	await expect(phone.getByText("Este curso no tiene apuntes")).toBeVisible();
	await expect(phone.getByText(`${COURSE}/materials/`)).toBeVisible();
	await context.close();
});
