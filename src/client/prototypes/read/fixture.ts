/**
 * The prototype's material and thread: three pages of a logic course's notes
 * and a session whose questions are anchored to passages on them.
 *
 * A passage is the stand-in for a pdf.js text-layer selection. `plain` is
 * what the text layer would give (Unicode, no LaTeX), so it is also the
 * anchor's `text`; `tex` is how the page draws it.
 */
import type { Anchor, Note, Turn } from "../../../shared/protocol.ts";

export const PDF_PATH = "logica/materials/apunte-3.pdf";
export const PDF_NAME = "apunte-3.pdf";
export const PAGE_COUNT = 40;

/** A run of page text: plain text with `$…$` math, or a passage that can be anchored. */
export type Run = string | { passage: string };

export type Para =
	| { kind: "h"; text: string }
	| { kind: "p" | "exercise"; runs: Run[] }
	| { kind: "rule"; tex: string };

export type Page = { n: number; paras: Para[] };

export type Passage = { id: string; page: number; tex: string; plain: string };

export const PASSAGES: Passage[] = [
	{
		id: "p12-intro",
		page: 12,
		tex: "Si a partir de la hipótesis $A$ se deriva $B$, se concluye $A\\to B$ y la hipótesis queda descartada.",
		plain:
			"Si a partir de la hipótesis A se deriva B, se concluye A → B y la hipótesis queda descartada.",
	},
	{
		id: "p12-derived",
		page: 12,
		tex: "Las reglas derivadas, como modus tollens, sólo pueden usarse después de haber sido demostradas a partir de las primitivas",
		plain:
			"Las reglas derivadas, como modus tollens, sólo pueden usarse después de haber sido demostradas a partir de las primitivas",
	},
	{
		id: "p12-ex3",
		page: 12,
		tex: "Ejercicio 3. Demostrar $\\vdash (p\\to q)\\to(\\neg q\\to\\neg p)$",
		plain: "Ejercicio 3. Demostrar ⊢ (p → q) → (¬q → ¬p)",
	},
	{
		id: "p13-neg",
		page: 13,
		tex: "la negación $\\neg A$ se trata como una abreviatura de $A\\to\\bot$",
		plain: "la negación ¬A se trata como una abreviatura de A → ⊥",
	},
];

const passage = (id: string) => {
	const p = PASSAGES.find((x) => x.id === id);
	if (!p) throw new Error(`no passage ${id}`);
	return p;
};

export const anchorOf = (id: string): Anchor => {
	const p = passage(id);
	return { path: PDF_PATH, page: p.page, text: p.plain };
};

/** The fixture passage an anchor quotes, if it is one of them. */
export const passageOf = (anchor: Anchor) =>
	PASSAGES.find((p) => p.page === anchor.page && p.plain === anchor.text);

export const PAGES: Page[] = [
	{
		n: 11,
		paras: [
			{ kind: "h", text: "3.1 Juicios y derivaciones" },
			{
				kind: "p",
				runs: [
					"Una derivación es un árbol cuyas hojas son hipótesis y cuya raíz es la conclusión. Cada paso aplica una regla: arriba de la línea van las premisas y abajo la conclusión. Escribimos $\\Gamma\\vdash A$ cuando hay una derivación de $A$ cuyas hipótesis no descartadas están en $\\Gamma$.",
				],
			},
			{
				kind: "p",
				runs: [
					"Las reglas vienen de a pares. La regla de introducción dice cómo se prueba una fórmula con un conectivo dado; la de eliminación, qué se puede concluir a partir de ella. Esta simetría es la que permite, más adelante, normalizar las derivaciones.",
				],
			},
			{ kind: "rule", tex: "\\dfrac{A\\qquad B}{A\\wedge B}\\;{\\wedge}I" },
			{
				kind: "p",
				runs: [
					"Por ejemplo, la conjunción se introduce a partir de sus dos componentes y se elimina tomando cualquiera de ellos. Ninguna de las dos reglas descarta hipótesis, así que la derivación conserva todas las hojas abiertas.",
				],
			},
		],
	},
	{
		n: 12,
		paras: [
			{ kind: "h", text: "3.2 Reglas para el condicional" },
			{
				kind: "p",
				runs: [
					"Las reglas de introducción y eliminación del condicional capturan su lectura constructiva: una prueba de $A\\to B$ es un método que transforma pruebas de $A$ en pruebas de $B$.",
				],
			},
			{
				kind: "p",
				runs: [
					"**Introducción del condicional.** ",
					{ passage: "p12-intro" },
					" La hipótesis se marca entre corchetes con un índice que la vincula a la regla que la descarta.",
				],
			},
			{
				kind: "rule",
				tex: "\\dfrac{\\begin{matrix}[A]^{i}\\\\ \\vdots\\\\ B\\end{matrix}}{A\\to B}\\;{\\to}I^{i}",
			},
			{
				kind: "p",
				runs: [
					"**Eliminación del condicional** (*modus ponens*). De $A\\to B$ y $A$ se concluye $B$.",
				],
			},
			{ kind: "rule", tex: "\\dfrac{A\\to B\\qquad A}{B}\\;{\\to}E" },
			{
				kind: "p",
				runs: [{ passage: "p12-derived" }, " (ver §3.5)."],
			},
			{
				kind: "exercise",
				runs: [{ passage: "p12-ex3" }, " usando sólo las reglas primitivas."],
			},
		],
	},
	{
		n: 13,
		paras: [
			{ kind: "h", text: "3.3 Negación y absurdo" },
			{
				kind: "p",
				runs: [
					"No agregamos reglas nuevas para la negación: ",
					{ passage: "p13-neg" },
					". Así, $\\neg I$ es un caso particular de $\\to I$ y $\\neg E$ uno de $\\to E$.",
				],
			},
			{ kind: "rule", tex: "\\dfrac{\\bot}{A}\\;\\bot E" },
			{
				kind: "p",
				runs: [
					"La regla $\\bot E$ (*ex falso quodlibet*) permite concluir cualquier fórmula a partir del absurdo. Sin ella obtenemos la lógica minimal; con ella, la intuicionista. La lógica clásica agrega además el principio del tercero excluido o, equivalentemente, la reducción al absurdo.",
				],
			},
		],
	},
];

// ── The thread ───────────────────────────────────────────────────────────────

const PROOF = JSON.stringify(
	{
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
	},
	null,
	2,
);

type Seed = { q: string; anchor?: string; answer: string; tool?: string };

const SEEDS: Seed[] = [
	{
		q: "¿Por qué la hipótesis queda *descartada*? No me cierra qué significa.",
		anchor: "p12-intro",
		answer:
			"Descartar la hipótesis quiere decir que la conclusión $A\\to B$ **ya no depende** de $A$. Mientras derivabas $B$, suponías $A$; al aplicar $\\to I$ esa suposición queda guardada adentro del condicional.\n\nPensalo así: $\\Gamma, A\\vdash B$ se convierte en $\\Gamma\\vdash A\\to B$. La $A$ sale de la izquierda del $\\vdash$ y pasa a la derecha. Por eso en el árbol se escribe $[A]^i$: los corchetes dicen que esa hoja ya no cuenta como hipótesis abierta.",
	},
	{
		q: "¿Y si nunca uso $A$ para llegar a $B$? ¿Vale igual?",
		anchor: "p12-intro",
		answer:
			"Sí. Es un **descarte vacuo**: la regla permite descartar cero apariciones de $A$. De $B$ solo podés concluir $A\\to B$ para cualquier $A$.\n\nPor ejemplo, de $q$ se deriva $p\\to q$ sin haber usado $p$.",
	},
	{
		q: "Entonces $\\neg p$ es lo mismo que $p\\to\\bot$, ¿no hay regla aparte?",
		anchor: "p13-neg",
		answer:
			"Exacto, en este apunte $\\neg A$ es una abreviatura. Por eso $\\neg I$ es $\\to I$ con $B=\\bot$, y $\\neg E$ es *modus ponens* con $B=\\bot$:\n\n$$\\dfrac{\\neg A\\qquad A}{\\bot}\\;\\neg E \\quad\\equiv\\quad \\dfrac{A\\to\\bot\\qquad A}{\\bot}\\;{\\to}E$$",
	},
	{
		q: "¿Cómo arranco el ejercicio 3?",
		anchor: "p12-ex3",
		tool: "Read",
		answer:
			"La fórmula es un condicional, así que el último paso tiene que ser $\\to I$. Trabajá **de abajo hacia arriba**:\n\n1. Para probar $(p\\to q)\\to(\\neg q\\to\\neg p)$, suponé $[p\\to q]^1$ y buscá $\\neg q\\to\\neg p$.\n2. De nuevo un condicional: suponé $[\\neg q]^2$ y buscá $\\neg p$.\n3. Como $\\neg p$ es $p\\to\\bot$, suponé $[p]^3$ y buscá $\\bot$.\n\nCon las tres hipótesis abiertas, el absurdo sale solo:\n\n$$\\dfrac{p\\to q\\qquad p}{q}\\;{\\to}E \\qquad\\qquad \\dfrac{\\neg q\\qquad q}{\\bot}\\;\\neg E$$\n\nArmado completo, cada índice marca qué regla descarta cada hipótesis:\n\n```proof\n" +
			PROOF +
			"\n```\n\nFijate que nunca usamos *modus tollens*: justamente este ejercicio **es** la demostración de que *modus tollens* se deriva de las primitivas, y por eso la página dice que solo se puede usar después (§3.5).",
	},
	{
		q: "¿Esto es lo mismo que el teorema de la deducción?",
		anchor: "p12-intro",
		answer:
			"Es la misma idea vista desde otro lado. En un sistema a la Hilbert, el **teorema de la deducción** es un resultado que hay que demostrar: si $\\Gamma, A\\vdash B$ entonces $\\Gamma\\vdash A\\to B$. En deducción natural ese paso es directamente una regla, $\\to I$.",
	},
	{
		q: "Resumime las reglas del condicional en una línea cada una.",
		answer:
			"- $\\to I$: si suponiendo $A$ llegás a $B$, tenés $A\\to B$ (y $A$ queda descartada).\n- $\\to E$: de $A\\to B$ y $A$, sacás $B$.",
	},
];

/** The answer that streams in on load: the "streaming answer" state. */
export const STREAMING: Seed = {
	q: "¿Por qué *modus tollens* no cuenta como primitiva?",
	anchor: "p12-derived",
	answer:
		"Porque se puede **derivar** de las primitivas, así que agregarla no cambia lo que se puede probar. Si tenés $A\\to B$ y $\\neg B$, suponé $[A]^1$:\n\n$$\\dfrac{\\dfrac{A\\to B\\qquad [A]^1}{B}\\;{\\to}E\\qquad \\neg B}{\\dfrac{\\bot}{\\neg A}\\;\\neg I^1}\\;\\neg E$$\n\nEsa derivación es exactamente la que pide el ejercicio 3, en forma de regla. Mantener pocas primitivas hace que los metateoremas (como la normalización) se prueben con menos casos.",
};

/** A canned answer for whatever the prototype is asked. */
export const CANNED =
	"En la app real acá respondería Claude, citando el pasaje. Por ahora: la regla $\\to I$ transforma $\\Gamma, A\\vdash B$ en $\\Gamma\\vdash A\\to B$, y $$\\dfrac{[A]^1\\;\\cdots\\;B}{A\\to B}\\;{\\to}I^1$$ es la forma en que la ves en el apunte.";

let seq = 0;
const id = (prefix: string) => `${prefix}-${++seq}`;

export function turnFrom(seed: Seed, anchor?: Anchor, done = true): Turn {
	const turnId = id("t");
	const blocks: Turn["blocks"] = [];
	if (seed.tool) {
		blocks.push({
			id: id("b"),
			kind: "tool",
			name: seed.tool,
			text: JSON.stringify({ file_path: PDF_PATH }),
			done: true,
			result: { ok: true, summary: "40 páginas" },
		});
	}
	blocks.push({
		id: id("b"),
		kind: "text",
		text: done ? seed.answer : "",
		done,
	});
	return {
		id: turnId,
		user: {
			turnId,
			clientMsgId: id("c"),
			from: "local",
			text: seed.q,
			attachments: [],
			...((anchor ?? (seed.anchor && anchorOf(seed.anchor)))
				? { anchor: anchor ?? anchorOf(seed.anchor as string) }
				: {}),
		},
		blocks,
		...(done
			? {
					end: {
						reason: "completed" as const,
						usage: { inputTokens: 0, outputTokens: 0 },
					},
				}
			: {}),
	};
}

export const seedTurns = () => SEEDS.map((s) => turnFrom(s));

export const seedNotes = (): Note[] => [
	{
		id: "n-1",
		anchor: anchorOf("p12-intro"),
		text: "Descartar = cerrar la caja de la hipótesis. Preguntar si en el parcial piden los índices.",
	},
	{ id: "n-2", anchor: anchorOf("p13-neg"), text: "Entra en el parcial." },
];

export const newNoteId = () => id("n");
