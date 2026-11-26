/**
 * Printing a session (step 12) on the production build. A long session is
 * written straight into the study folder as its `.md`: math, one block of
 * every kind (some wider than a page), a wide table, a photo and a note.
 * "Imprimir" (or ⌘P / Ctrl+P) mounts the print copy and calls
 * `window.print()`, stubbed here; print media then shows only that copy,
 * light even on a dark screen, with every block drawn and nothing wider
 * than the page.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "./fixtures.ts";
import { NOTES, textPdf } from "./pdf.ts";

const COURSE = "imprimir";
const STUDY = ".e2e/study";
const NAME = "2026-11-26-impresa";
const ID = "5e551000-0000-4000-8000-00000000c0de";
const TITLE = "Contrarrecíproco y la normal";
const PHOTO = `${COURSE}/sessions/${NAME}/001-photo.png`;
const PDF = `${COURSE}/materials/apunte.pdf`;

const fence = (lang: string, body: unknown) =>
	`\`\`\`${lang}\n${typeof body === "string" ? body : JSON.stringify(body, null, 2)}\n\`\`\``;

/** A proof tree far wider than a page: ∧I over eight long premises. */
const WIDE_PROOF = {
	conclusion: "\\bigwedge_{i=1}^{8} (p_i \\to q_i)",
	rule: "{\\land}\\mathrm{I}",
	premises: Array.from({ length: 8 }, (_, i) => ({
		conclusion: `p_${i + 1} \\to q_${i + 1}`,
		rule: "{\\to}\\mathrm{I}",
		premises: [{ conclusion: `q_${i + 1} \\lor \\neg p_${i + 1}` }],
	})),
};

const BLOCKS: Record<string, string> = {
	dot: fence(
		"dot",
		`digraph AFD {
  rankdir=LR;
  node [shape=circle];
  inicio [shape=point];
  q0 [shape=doublecircle];
  inicio -> q0;
  q0 -> q1 [label="0"];
  q1 -> q0 [label="0"];
  q0 -> q0 [label="1"];
  q1 -> q1 [label="1"];
}`,
	),
	proof: fence("proof", WIDE_PROOF),
	fitch: fence("fitch", {
		lines: [
			{ formula: "p\\to q", justification: "\\text{Sup.}", depth: 1 },
			{ formula: "\\neg q", justification: "\\text{Sup.}", depth: 2 },
			{ formula: "p", justification: "\\text{Sup.}", depth: 3 },
			{ formula: "q", justification: "{\\to}\\mathrm{E}\\ 1, 3", depth: 3 },
			{ formula: "\\bot", justification: "\\neg\\mathrm{E}\\ 2, 4", depth: 3 },
			{
				formula: "\\neg p",
				justification: "\\neg\\mathrm{I}\\ 3\\text{–}5",
				depth: 2,
			},
		],
	}),
	plot: fence("plot", {
		xDomain: [-4, 4],
		yDomain: [0, 0.45],
		xLabel: "x",
		items: [
			{
				region: { fn: "normpdf(x)", from: 1.5, to: null },
				label: "P(X>1{,}5)",
			},
			{ fn: "normpdf(x)", label: "X\\sim N(0,1)" },
		],
	}),
	"vega-lite": fence("vega-lite", {
		data: {
			values: [2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 7, 8].map((x) => ({ x })),
		},
		mark: "bar",
		encoding: {
			x: { field: "x", bin: { maxbins: 7 }, title: "Nota" },
			y: { aggregate: "count", title: "Frecuencia" },
		},
	}),
	mermaid: fence(
		"mermaid",
		"stateDiagram-v2\n  direction LR\n  [*] --> q0\n  q0 --> q1: 0\n  q1 --> q0: 0\n  q0 --> [*]",
	),
};
const KINDS = Object.keys(BLOCKS);

const WIDE_TABLE = [
	`| ${["p", "q", "r", "s", "t", "u", "v", "w"].map((v) => `$${v}$`).join(" | ")} | $p\\land q\\land r\\land s\\land t\\land u\\land v\\land w$ | $\\neg(p\\lor q\\lor r\\lor s\\lor t\\lor u\\lor v\\lor w)$ |`,
	`|${" --- |".repeat(10)}`,
	`| ${Array(8).fill("V").join(" | ")} | V | F |`,
	`| ${Array(8).fill("F").join(" | ")} | F | V |`,
].join("\n");

const WIDE_MATH =
	"$$\nP(X \\le k) = \\sum_{i=0}^{k} \\binom{n}{i} p^i (1-p)^{n-i} = \\binom{n}{0}(1-p)^n + \\binom{n}{1}p(1-p)^{n-1} + \\binom{n}{2}p^2(1-p)^{n-2} + \\binom{n}{3}p^3(1-p)^{n-3} + \\cdots\n$$";

/** The turns: one per block kind, then math, a wide table and a photo. */
const TURNS: { q: string; a: string; photo?: boolean }[] = [
	...KINDS.map((kind) => ({
		q: `Mostrame un ejemplo de \`${kind}\`.`,
		a: `Acá va, con $x^2$ en el texto:\n\n${BLOCKS[kind]}\n\nY sigue el texto.`,
	})),
	{
		q: "¿Cuánto vale $\\operatorname{Var}(X)$ si $X\\sim\\mathrm{Bin}(n,p)$?",
		a: `Por linealidad:\n\n$$\n\\begin{aligned}\n\\operatorname{Var}(X) &= \\sum_{i=1}^n \\operatorname{Var}(X_i) \\\\\n&= np(1-p).\n\\end{aligned}\n$$\n\nY la acumulada:\n\n${WIDE_MATH}`,
	},
	{ q: "Tabla de verdad con ocho variables.", a: WIDE_TABLE },
	{
		q: "¿Está bien mi solución?",
		a: "Sí: el paso 2 es correcto.",
		photo: true,
	},
];

function sessionMd() {
	const body = TURNS.map(
		(t) =>
			`## Tú\n\n${t.q}${t.photo ? `\n\n![Foto](../../${PHOTO})` : ""}\n\n## Claude\n\n${t.a}\n`,
	).join("\n");
	const note = `## Nota\n\n> [!note] [apunte.pdf, p. 3](../../${PDF}#page=3)\n> > Teorema 3. Toda sucesion convergente es acotada.\n>\n> Repasar la demostración para el parcial.\n`;
	return `---\nid: ${ID}\ncourse: ${COURSE}\ntitle: "${TITLE}"\ncreated: 2026-11-26T15:00:00.000Z\n---\n\n${body}\n${note}`;
}

/** A 600×400 "photo", drawn in the browser. */
async function photoPng(page: Page) {
	const data = await page.evaluate(() => {
		const c = document.createElement("canvas");
		c.width = 600;
		c.height = 400;
		const g = c.getContext("2d");
		if (!g) throw new Error("no 2d context");
		g.fillStyle = "#f4f1e8";
		g.fillRect(0, 0, 600, 400);
		g.fillStyle = "#1d1c1a";
		g.font = "40px serif";
		g.fillText("x² − 1 = (x − 1)(x + 1)", 40, 200);
		return c.toDataURL("image/png").split(",")[1] ?? "";
	});
	return Buffer.from(data, "base64");
}

test.beforeAll(() => {
	mkdirSync(join(STUDY, COURSE, "sessions", NAME), { recursive: true });
	mkdirSync(join(STUDY, COURSE, "materials"), { recursive: true });
	writeFileSync(join(STUDY, PDF), textPdf(NOTES));
	writeFileSync(join(STUDY, COURSE, "sessions", `${NAME}.md`), sessionMd());
});

/** Stubs `window.print()`, collects CSP violations, and opens the session in `view`. */
async function open(page: Page, view: "read" | "practice") {
	const violations: string[] = [];
	page.on("console", (m) => {
		if (/content security policy/i.test(m.text())) violations.push(m.text());
	});
	await page.addInitScript((v) => {
		localStorage.setItem("lemma:view", v);
		const w = window as unknown as { printed: number; undrawn: string[] };
		w.printed = 0;
		// What the dialog would capture: anything still loading, or a block
		// with nothing drawn, at the moment print() is called.
		window.print = () => {
			w.printed += 1;
			const root = document.querySelector(".print-root");
			w.undrawn = root
				? [
						...[...root.querySelectorAll("[data-pending]")].map(
							(n) => `pending ${n.className}`,
						),
						...[...root.querySelectorAll(".diagram")]
							.filter((d) => !d.querySelector(".diagram-body :is(svg, .katex)"))
							.map((d) => `empty ${d.getAttribute("data-block")}`),
					]
				: ["no copy"];
		};
		document.addEventListener("securitypolicyviolation", (e) =>
			console.error(`content security policy: ${e.violatedDirective}`),
		);
	}, view);
	const photo = await photoPng(page);
	writeFileSync(join(STUDY, PHOTO), photo);
	await page.goto(`/s/${ID}`);
	await expect(
		page.getByRole("button", { name: "Imprimir", exact: true }),
	).toBeVisible();
	return violations;
}

const printed = (page: Page) =>
	page.evaluate(() => (window as unknown as { printed: number }).printed);

/** What wasn't drawn yet when print() was called. */
const undrawn = (page: Page) =>
	page.evaluate(() => (window as unknown as { undrawn: string[] }).undrawn);

/** What print media shows: only the copy, every turn and block drawn, nothing past the page. */
async function expectPrintable(page: Page) {
	await page.emulateMedia({ media: "print" });
	const root = page.locator(".print-root");
	await expect(root).toBeVisible();
	await expect(page.locator("header").first()).toBeHidden();
	await expect(page.locator("#composer")).toBeHidden();
	await expect(page.locator("#root")).toBeHidden();

	await expect(root.locator("h1")).toHaveText(TITLE);
	await expect(root.locator(".print-head")).toContainText(
		"imprimir · 26 de noviembre de 2026",
	);
	await expect(root.locator(".print-turn")).toHaveCount(TURNS.length);

	// Every block drew, and none is a placeholder.
	await expect(root.locator(".diagram")).toHaveCount(KINDS.length);
	for (const kind of KINDS) {
		const block = root.locator(`.diagram[data-block="${kind}"]`);
		await expect(block).toHaveAttribute("data-state", "ok");
		const drawn = block.locator(
			kind === "proof"
				? ".diagram-body .pt .katex"
				: kind === "fitch"
					? ".diagram-body .fk .katex"
					: ".diagram-body svg",
		);
		await expect(drawn.first()).toBeVisible();
	}
	expect(
		await root.locator("[data-pending], .katex-error, button:visible").count(),
	).toBe(0);
	await expect(root.locator(".katex-display")).toHaveCount(2);

	// The photo loaded; the note printed with its quote.
	const img = root.locator("img");
	await expect(img).toHaveCount(1);
	expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(600);
	await expect(root.locator(".print-note")).toContainText(
		"Toda sucesion convergente",
	);
	await expect(root.locator(".print-note")).toContainText(
		"Repasar la demostración",
	);

	// Nothing reaches past the page's column: wide content was zoomed to fit.
	const overflow = await root.evaluate((el) => {
		const right = el.getBoundingClientRect().right + 1;
		return [...el.querySelectorAll("*")]
			.filter((n) => n.getBoundingClientRect().right > right)
			.map((n) => n.className.toString() || n.tagName);
	});
	expect(overflow).toEqual([]);
	const zoomed = await root.evaluate(
		(el) => [...el.querySelectorAll<HTMLElement>("[style*=zoom]")].length,
	);
	expect(zoomed).toBeGreaterThanOrEqual(2);

	// Light whatever the screen's scheme.
	const colors = await root.evaluate((el) => ({
		ink: getComputedStyle(el.querySelector("h1") as Element).color,
		page: getComputedStyle(document.body).backgroundColor,
	}));
	expect(colors).toEqual({
		ink: "rgb(29, 28, 26)",
		page: "rgb(255, 255, 255)",
	});
}

test("Imprimir prints the Practice thread as a light document, every block drawn", async ({
	page,
}) => {
	await page.emulateMedia({ colorScheme: "dark" });
	const violations = await open(page, "practice");
	// Off-screen turns: the notebook opens at the bottom, far from the first blocks.
	await page.getByRole("button", { name: "Imprimir", exact: true }).click();
	await expect.poll(() => printed(page)).toBe(1);
	expect(await undrawn(page)).toEqual([]);
	await expectPrintable(page);

	// Mermaid bakes its colours in: the screen's copy is dark, the print's light.
	const dark = (where: string) =>
		page
			.locator(`${where} .diagram[data-block="mermaid"] .diagram-body svg`)
			.evaluate((svg) => svg.outerHTML.includes("#1f1f1c"));
	expect(await dark("#root")).toBe(true);
	expect(await dark(".print-root")).toBe(false);

	// The PDF's default file name is the session's title, until the dialog closes.
	await expect(page).toHaveTitle(`${TITLE} · ${COURSE}`);

	// The dialog closing unmounts the copy; the screen is as it was.
	await page.emulateMedia({ media: "screen" });
	await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
	await expect(page.locator(".print-root")).toHaveCount(0);
	await expect(page).toHaveTitle("Lemma");
	await expect(page.locator("#composer")).toBeVisible();
	expect(violations).toEqual([]);
});

test("⌘P / Ctrl+P from Read prints the transcript, not the PDF", async ({
	page,
}) => {
	const violations = await open(page, "read");
	await expect(page.locator(".pdf-page").first()).toBeVisible({
		timeout: 15_000,
	});
	await page.keyboard.press("ControlOrMeta+p");
	await expect.poll(() => printed(page)).toBe(1);
	expect(await undrawn(page)).toEqual([]);
	await expectPrintable(page);
	await expect(page.locator(".pdf-page").first()).toBeHidden();
	expect(violations).toEqual([]);
});
