/** Real course content for the block prototypes, as the JSON Claude would emit. */
import type { Fitch, Plot, ProofNode } from "../blocks/schema.ts";

/** ⊢ (p→q)→(¬q→¬p) by natural deduction. */
export const contraposition: ProofNode = {
	conclusion: "(p\\to q)\\to(\\neg q\\to\\neg p)",
	rule: "{\\to}\\mathrm{I}",
	discharged: "1",
	premises: [
		{
			conclusion: "\\neg q\\to\\neg p",
			rule: "{\\to}\\mathrm{I}",
			discharged: "2",
			premises: [
				{
					conclusion: "\\neg p",
					rule: "\\neg\\mathrm{I}",
					discharged: "3",
					premises: [
						{
							conclusion: "\\bot",
							rule: "\\neg\\mathrm{E}",
							premises: [
								{
									conclusion: "q",
									rule: "{\\to}\\mathrm{E}",
									premises: [
										{ conclusion: "p\\to q", discharged: "1" },
										{ conclusion: "p", discharged: "3" },
									],
								},
								{ conclusion: "\\neg q", discharged: "2" },
							],
						},
					],
				},
			],
		},
	],
};

/** ⊢ p ∨ ¬p in the sequent calculus LK. */
export const excludedMiddle: ProofNode = {
	conclusion: "\\vdash p\\lor\\neg p",
	rule: "\\mathrm{C}_R",
	premises: [
		{
			conclusion: "\\vdash p\\lor\\neg p,\\; p\\lor\\neg p",
			rule: "{\\lor}_{R_2}",
			premises: [
				{
					conclusion: "\\vdash p\\lor\\neg p,\\; \\neg p",
					rule: "{\\lor}_{R_1}",
					premises: [
						{
							conclusion: "\\vdash p,\\; \\neg p",
							rule: "\\neg_R",
							premises: [
								{
									conclusion: "p\\vdash p",
									rule: "\\mathrm{Ax}",
									premises: [],
								},
							],
						},
					],
				},
			],
		},
	],
};

export const contrapositionFitch: Fitch = {
	lines: [
		{ formula: "p\\to q", justification: "\\text{Sup.}", depth: 1 },
		{ formula: "\\neg q", justification: "\\text{Sup.}", depth: 2 },
		{ formula: "p", justification: "\\text{Sup.}", depth: 3 },
		{ formula: "q", justification: "{\\to}\\mathrm{E}\\ 1, 3", depth: 3 },
		{ formula: "\\bot", justification: "\\neg\\mathrm{E}\\ 2, 4", depth: 3 },
		{ formula: "\\neg p", justification: "\\neg\\mathrm{I}\\ 3\\text{–}5", depth: 2 },
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
};

export const normalTail: Plot = {
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
};

const pmf = [0.07776, 0.2592, 0.3456, 0.2304, 0.0768, 0.01024];
let acc = 0;
const cdf = pmf.map((p, k) => {
	acc += p;
	return [k, Math.round(acc * 1e5) / 1e5] as [number, number];
});

export const binomial: Plot = {
	xDomain: [-0.5, 5.5],
	yDomain: [0, 1.05],
	xLabel: "k",
	items: [
		{ stem: pmf.map((p, k) => [k, p] as [number, number]), label: "P(X=k)" },
		{ step: cdf, label: "F(k)=P(X\\le k)", color: "warning" },
	],
};
