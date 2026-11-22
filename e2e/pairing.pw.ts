import { expect, test, unpaired } from "./fixtures.ts";

const DEV_ORIGIN = "http://127.0.0.1:5173";

test("a browser that isn't paired gets the pairing screen and nothing else", async ({
	browser,
}) => {
	const stranger = await unpaired(browser);
	const page = await stranger.newPage();
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "Vinculá este navegador" }),
	).toBeVisible();
	expect((await page.request.get("/api/state")).status()).toBe(403);
	expect(
		(
			await page.request.post("/api/sessions", { data: { course: "x" } })
		).status(),
	).toBe(403);
	await stranger.close();
});

test("a link from Dispositivos pairs another browser once, then says it no longer works", async ({
	page,
	browser,
}) => {
	await page.goto("/");
	await page.getByRole("button", { name: "Dispositivos" }).click();
	await page.getByRole("button", { name: "Vincular otro navegador" }).click();
	const url = await page.getByLabel("Enlace para vincular").inputValue();
	expect(url).toMatch(/^http:\/\/127\.0\.0\.1:4318\/pair\/[\w-]{22}$/);

	const other = await unpaired(browser);
	const second = await other.newPage();
	await second.goto(url);
	await expect(second).toHaveURL(/\/s\/[\w-]+$/);
	await expect(second.getByLabel("Mensaje")).toBeVisible();

	// Used once: the same link now shows the expired screen with a 403.
	const fresh = await (await unpaired(browser)).newPage();
	const reused = await fresh.goto(url);
	expect(reused?.status()).toBe(403);
	await expect(
		fresh.getByRole("heading", { name: "Este enlace ya no sirve" }),
	).toBeVisible();
	// The paired browser opening it again is told it can go on.
	await second.goto(url);
	await expect(second.getByRole("link", { name: "Abrir Lemma" })).toBeVisible();
	await second.getByRole("link", { name: "Abrir Lemma" }).click();
	await expect(second).toHaveURL(/\/s\/[\w-]+$/);
	await other.close();
	await fresh.context().close();
});

test("unpairing a browser from another one sends it to the pairing screen", async ({
	page,
	browser,
}) => {
	const link = await page.request.post("/api/pair");
	const { url } = (await link.json()) as { url: string };
	const other = await unpaired(browser);
	const second = await other.newPage();
	await second.goto(url);
	await expect(second.getByLabel("Mensaje")).toBeVisible();
	const { current } = (await (
		await second.request.get("/api/devices")
	).json()) as { current: string };

	await page.goto("/");
	await page.getByRole("button", { name: "Dispositivos" }).click();
	const list = page.getByRole("list", { name: "Navegadores vinculados" });
	await expect(list.getByRole("listitem").first()).toBeVisible();
	const res = await page.request.delete(`/api/devices/${current}`);
	expect(res.status()).toBe(204);

	// Its socket is closed, and it shows the pairing screen without a reload.
	await expect(
		second.getByRole("heading", { name: "Vinculá este navegador" }),
	).toBeVisible();
	expect((await second.request.get("/api/state")).status()).toBe(403);
	await other.close();
});

test("the production build refuses the Vite dev origin", async ({ page }) => {
	const res = await page.request.post("/api/sessions", {
		data: { course: "x" },
		headers: { origin: DEV_ORIGIN },
	});
	expect(res.status()).toBe(403);
	expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
		"bad_origin",
	);
	const ok = await page.request.post("/api/sessions", {
		data: { course: "x" },
		headers: { origin: "http://127.0.0.1:4318" },
	});
	expect(ok.status()).toBe(201);
});
