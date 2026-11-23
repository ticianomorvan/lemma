/**
 * The diagram-block fixture page (step 6): one valid and one broken block of
 * each kind, a block whose fence hasn't closed, and two injection probes,
 * each rendered through the real Markdown pipeline. Playwright checks it
 * (e2e/blocks.pw.ts); it is also the place to look at every block by eye.
 * Served from the build at /fixtures/blocks.html; `?theme=light|dark`.
 * It holds no data and calls no API.
 */
import "../globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Markdown } from "../markdown/markdown.tsx";

const fence = (lang: string, body: string, close = true) =>
	`\`\`\`${lang}\n${body}\n${close ? "```\n" : ""}`;

const json = (v: unknown) => JSON.stringify(v, null, 2);

const CASES: { id: string; title: string; md: string }[] = [
	{
		id: "dot-valid",
		title: "AFD: cantidad par de 0s",
		md: fence(
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
	},
	{
		id: "dot-broken",
		title: "dot inválido",
		md: fence("dot", "digraph { a -> }"),
	},
	{
		id: "proof-valid",
		title: "Deducción natural",
		md: fence(
			"proof",
			json({
				conclusion: "(p\\to q)\\to(\\neg q\\to\\neg p)",
				rule: "{\\to}\\mathrm{I}",
				discharged: 1,
				premises: [
					{
						conclusion: "\\neg q\\to\\neg p",
						rule: "{\\to}\\mathrm{I}",
						discharged: 2,
						premises: [
							{
								conclusion: "\\neg p",
								rule: "\\neg\\mathrm{I}",
								discharged: 3,
								premises: [
									{
										conclusion: "\\bot",
										rule: "\\neg\\mathrm{E}",
										premises: [
											{
												conclusion: "q",
												rule: "{\\to}\\mathrm{E}",
												premises: [
													{ conclusion: "p\\to q", discharged: 1 },
													{ conclusion: "p", discharged: 3 },
												],
											},
											{ conclusion: "\\neg q", discharged: 2 },
										],
									},
								],
							},
						],
					},
				],
			}),
		),
	},
	{
		id: "proof-broken",
		title: "proof sin conclusión",
		md: fence(
			"proof",
			json({ conclusion: "q", premises: [{ rule: "\\to E" }] }),
		),
	},
	{
		id: "fitch-valid",
		title: "Fitch",
		md: fence(
			"fitch",
			json({
				lines: [
					{ formula: "p\\to q", justification: "\\text{Sup.}", depth: 1 },
					{ formula: "\\neg q", justification: "\\text{Sup.}", depth: 2 },
					{ formula: "p", justification: "\\text{Sup.}", depth: 3 },
					{ formula: "q", justification: "{\\to}\\mathrm{E}\\ 1, 3", depth: 3 },
					{
						formula: "\\bot",
						justification: "\\neg\\mathrm{E}\\ 2, 4",
						depth: 3,
					},
					{
						formula: "\\neg p",
						justification: "\\neg\\mathrm{I}\\ 3\\text{–}5",
						depth: 2,
					},
					{
						formula: "\\neg q\\to\\neg p",
						justification: "{\\to}\\mathrm{I}\\ 2\\text{–}6",
						depth: 1,
					},
					{
						formula: "(p\\to q)\\to(\\neg q\\to\\neg p)",
						justification: "{\\to}\\mathrm{I}\\ 1\\text{–}7",
						depth: 0,
					},
				],
			}),
		),
	},
	{
		id: "fitch-broken",
		title: "fitch con profundidad negativa",
		md: fence("fitch", json({ lines: [{ formula: "p", depth: -1 }] })),
	},
	{
		id: "plot-valid",
		title: "Normal con P(X>1,5)",
		md: fence(
			"plot",
			json({
				xDomain: [-4, 4],
				yDomain: [0, 0.45],
				xLabel: "x",
				yLabel: "\\varphi(x)",
				items: [
					{
						region: { fn: "normpdf(x)", from: 1.5, to: null },
						label: "P(X>1{,}5)\\approx 0{,}0668",
					},
					{ fn: "normpdf(x)", label: "X\\sim N(0,1)" },
					{ vline: 1.5, label: "1{,}5" },
				],
			}),
		),
	},
	{
		id: "plot-poles",
		title: "tan(x): sus ramas no se unen",
		md: fence(
			"plot",
			json({ xDomain: [-4, 4], yDomain: [-5, 5], items: [{ fn: "tan(x)" }] }),
		),
	},
	{
		id: "plot-broken",
		title: "plot con una expresión prohibida",
		md: fence(
			"plot",
			json({ xDomain: [-3, 3], yDomain: [0, 1], items: [{ fn: "alert(1)" }] }),
		),
	},
	{
		id: "vega-lite-valid",
		title: "Histograma",
		md: fence(
			"vega-lite",
			json({
				data: {
					values: [2, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 7, 7, 8].map((x) => ({
						x,
					})),
				},
				mark: "bar",
				encoding: {
					x: { field: "x", bin: { maxbins: 7 }, title: "Nota" },
					y: { aggregate: "count", title: "Frecuencia" },
				},
			}),
		),
	},
	{
		id: "vega-lite-broken",
		title: "vega-lite que pide una URL",
		md: fence(
			"vega-lite",
			json({
				data: { url: "https://example.com/datos.csv" },
				mark: "bar",
				encoding: { x: { field: "a" } },
			}),
		),
	},
	{
		id: "mermaid-valid",
		title: "Diagrama de estados",
		md: fence(
			"mermaid",
			`stateDiagram-v2
  direction LR
  [*] --> q0
  q0 --> q1: 0
  q1 --> q0: 0
  q0 --> q0: 1
  q1 --> q1: 1
  q0 --> [*]`,
		),
	},
	{
		id: "mermaid-broken",
		title: "mermaid inválido",
		md: fence("mermaid", "flowchart LR\n  A -->|sin cerrar"),
	},
	{
		id: "pending",
		title: "Un bloque que todavía llega",
		md: `Ahora el gráfico:\n\n${fence("plot", '{\n  "xDomain": [0, 1],\n  "items": [{"fn": "x^', false)}`,
	},
	{
		id: "dot-link",
		title: "dot con un enlace javascript:",
		md: fence(
			"dot",
			'digraph { a [URL="javascript:alert(1)" label="a"]; a -> b [href="https://example.com"]; }',
		),
	},
	{
		id: "mermaid-click",
		title: "mermaid con click",
		md: fence(
			"mermaid",
			'flowchart LR\n  A[Inicio] --> B[Fin]\n  click A "javascript:alert(1)"',
		),
	},
];

function Page() {
	return (
		<main className="min-h-dvh bg-paper">
			<div className="mx-auto max-w-[720px] px-4 pt-6 pb-16 sm:px-8 sm:pt-8">
				<h1 className="mb-6 font-heading text-2xl">Bloques de diagramas</h1>
				{CASES.map((c) => (
					<section key={c.id} data-case={c.id} className="border-t py-5">
						<h2 className="mb-3 text-[13px] font-medium text-muted-foreground">
							{c.title}
						</h2>
						<div className="answer min-w-0 [&]:text-[16px]">
							<Markdown text={c.md} />
						</div>
					</section>
				))}
			</div>
		</main>
	);
}

const theme = new URLSearchParams(location.search).get("theme");
if (theme === "light" || theme === "dark") {
	document.documentElement.dataset.theme = theme;
}
const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<Page />
		</StrictMode>,
	);
}
