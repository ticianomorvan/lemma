/**
 * The step 6 live check: 10 prompts from both courses, asked of the real
 * Claude through your own login, each in a fresh session of a production
 * build. A prompt passes when every block kind it expects renders, no block
 * or formula shows an error, and (for the truth table) a table renders.
 *
 *   bun run build && bun e2e/live-blocks.ts <out dir>
 *
 * It writes one screenshot per prompt and `results.json` to <out dir>.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const PROMPTS: { q: string; expect: string[]; table?: boolean }[] = [
	{
		q: "Dibujá el AFD que acepta cadenas con cantidad par de 0s.",
		expect: ["dot"],
	},
	{
		q: "Derivá $(p\\to q)\\to(\\neg q\\to\\neg p)$ por deducción natural.",
		expect: ["proof"],
	},
	{ q: "Graficá la densidad normal y sombreá $P(X>1.5)$.", expect: ["plot"] },
	{ q: "Tabla de verdad de $p\\lor\\neg p$.", expect: [], table: true },
	{ q: "Demostrá $p\\to(q\\to p)$ en estilo Fitch.", expect: ["fitch"] },
	{
		q: "Probá $\\vdash p\\lor\\neg p$ en el cálculo de secuentes.",
		expect: ["proof"],
	},
	{
		q: "Hacé un histograma de estas notas: 2, 3, 3, 4, 5, 5, 5, 6, 6, 7, 7, 8, 9.",
		expect: ["vega-lite"],
	},
	{
		q: "Mostrá con un diagrama de estados en Mermaid el autómata que reconoce las cadenas sobre {a, b} que terminan en ab.",
		expect: ["mermaid"],
	},
	{
		q: "Graficá la función de probabilidad y la de distribución de una binomial con n = 5 y p = 0,4.",
		expect: ["plot"],
	},
	{
		q: "Dibujá el árbol de derivación de la cadena aabb con la gramática S → aSb | ε.",
		expect: ["dot"],
	},
];

const out: string =
	process.argv[2] ??
	(() => {
		throw new Error("usage: bun e2e/live-blocks.ts <out dir>");
	})();
mkdirSync(out, { recursive: true });

const port = 4340;
const base = mkdtempSync(join(tmpdir(), "lemma-live-blocks-"));
const config = join(base, "config");
const study = join(base, "study");
mkdirSync(config);
mkdirSync(study);
await Bun.spawn(["bun", "e2e/seed-device.ts", config, String(port)]).exited;
const server = Bun.spawn(["bun", "run", "start"], {
	env: {
		...process.env,
		PORT: String(port),
		LEMMA_STUDY_DIR: study,
		LEMMA_CONFIG_DIR: config,
		LEMMA_OPEN: "0",
	},
	stdout: "ignore",
	stderr: "inherit",
});
const url = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i++) {
	if (
		await fetch(url).then(
			() => true,
			() => false,
		)
	)
		break;
	await Bun.sleep(200);
}

const [name = "", value = ""] = readFileSync(join(config, "e2e-cookie"), "utf8")
	.trim()
	.split("=");
const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: 900, height: 1000 },
	deviceScaleFactor: 2,
});
await context.addCookies([
	{
		name,
		value,
		domain: "127.0.0.1",
		path: "/",
		httpOnly: true,
		sameSite: "Strict",
	},
]);

type Result = {
	n: number;
	q: string;
	pass: boolean;
	kinds: Record<string, string>;
	notes: string[];
};
const results: Result[] = [];

async function ask(
	n: number,
	prompt: (typeof PROMPTS)[number],
): Promise<Result> {
	const page = await context.newPage();
	const notes: string[] = [];
	try {
		const res = await page.request.post(`${url}/api/sessions`, {
			data: {
				course: n === 3 || n === 7 || n === 9 ? "probabilidad" : "logica",
			},
		});
		const { id } = (await res.json()) as { id: string };
		await page.goto(`${url}/s/${id}`);
		const box = page.getByLabel("Mensaje");
		await box.fill(prompt.q);
		await box.press("Enter");
		await page
			.getByRole("button", { name: /Detener/ })
			.waitFor({ state: "visible" });
		await page
			.getByRole("button", { name: /Detener/ })
			.waitFor({ state: "hidden", timeout: 240_000 });
		// Renderers load lazily; give them a moment to settle.
		await page.waitForFunction(
			() => !document.querySelector('.diagram[data-state="loading"]'),
			undefined,
			{ timeout: 20_000 },
		);
		const kinds = await page.$$eval(".answer .diagram", (els) =>
			Object.fromEntries(
				els.map((e, i) => [
					`${e.getAttribute("data-block")}#${i}`,
					e.getAttribute("data-state") ?? "",
				]),
			),
		);
		const errors = await page
			.locator('.diagram[data-state="error"] .diagram-error')
			.allTextContents();
		notes.push(...errors);
		const katexErrors = await page.locator(".katex-error").count();
		if (katexErrors) notes.push(`${katexErrors} KaTeX errors`);
		const states = Object.entries(kinds);
		const missing = prompt.expect.filter(
			(k) =>
				!states.some(
					([key, state]) => key.startsWith(`${k}#`) && state === "ok",
				),
		);
		if (missing.length) notes.push(`missing: ${missing.join(", ")}`);
		const tableOk =
			!prompt.table || (await page.locator(".answer table").count()) > 0;
		if (!tableOk) notes.push("no table");
		const pass = !missing.length && !errors.length && !katexErrors && tableOk;
		// The thread scrolls inside its own pane: make the window tall enough to hold it.
		const height = await page.evaluate(
			() =>
				document.querySelector("section[id^='turn-']")?.scrollHeight ?? 1000,
		);
		await page.setViewportSize({ width: 900, height: height + 400 });
		await page
			.locator("section[id^='turn-']")
			.last()
			.screenshot({ path: join(out, `${String(n).padStart(2, "0")}.png`) });
		return { n, q: prompt.q, pass, kinds, notes };
	} catch (e) {
		await page.screenshot({
			path: join(out, `${String(n).padStart(2, "0")}.png`),
			fullPage: true,
		});
		return { n, q: prompt.q, pass: false, kinds: {}, notes: [String(e)] };
	} finally {
		await page.close();
	}
}

// Three at a time: each session runs its own `claude` process.
const queue = PROMPTS.map((p, i) => [i + 1, p] as const);
await Promise.all(
	Array.from({ length: 3 }, async () => {
		for (let job = queue.shift(); job; job = queue.shift()) {
			const r = await ask(job[0], job[1]);
			console.log(
				`${r.pass ? "PASS" : "FAIL"} ${r.n}. ${r.q} ${JSON.stringify(r.kinds)} ${r.notes.join(" | ")}`,
			);
			results.push(r);
		}
	}),
);
results.sort((a, b) => a.n - b.n);
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));
await browser.close();
server.kill();
console.log(`${results.filter((r) => r.pass).length}/${results.length} passed`);
