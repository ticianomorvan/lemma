/**
 * `proof`: a natural-deduction or sequent tree, Gentzen style. Each rule's
 * line spans its premises, its name sits to the right. A discharged
 * assumption and the rule that discharges it share a label; pointing at
 * either lights up both.
 */
import { useState } from "react";
import { type ProofNode, parseBlock, proofSchema } from "./schema.ts";
import { Tex } from "./tex.tsx";

const MAX_NODES = 200;

export default function Proof({ source }: { source: string }) {
	const proof = parseBlock(proofSchema, source);
	if (count(proof) > MAX_NODES) {
		throw new Error(`la prueba tiene más de ${MAX_NODES} pasos`);
	}
	return <ProofTree proof={proof} />;
}

function count(n: ProofNode): number {
	return 1 + (n.premises ?? []).reduce((s, p) => s + count(p), 0);
}

function ProofTree({ proof }: { proof: ProofNode }) {
	const [hot, setHot] = useState<string | null>(null);
	return (
		<div className="diagram-scroll">
			<div className="pt">
				<Node node={proof} hot={hot} setHot={setHot} />
			</div>
		</div>
	);
}

const leafTex = (n: ProofNode) =>
	n.discharged ? `[${n.conclusion}]^{${n.discharged}}` : n.conclusion;
const ruleTex = (n: ProofNode) =>
	`${n.rule ?? ""}${n.discharged ? `^{${n.discharged}}` : ""}`;

function Node({
	node,
	hot,
	setHot,
}: {
	node: ProofNode;
	hot: string | null;
	setHot: (v: string | null) => void;
}) {
	const mark = node.discharged;
	const isHot = mark !== undefined && hot === mark;
	const hover = mark
		? {
				onPointerEnter: () => setHot(mark),
				onPointerLeave: () => setHot(null),
			}
		: {};
	// A leaf is an assumption (or an axiom with no line above it).
	if (!node.premises) {
		return (
			<div className="pt-node">
				<div
					className="pt-conc pt-leaf"
					data-discharged={mark ? "" : undefined}
					data-hot={isHot || undefined}
					{...hover}
				>
					<Tex tex={leafTex(node)} />
				</div>
			</div>
		);
	}
	return (
		<div className="pt-node">
			<div className="pt-premises">
				{node.premises.map((p, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: a static tree
					<Node key={i} node={p} hot={hot} setHot={setHot} />
				))}
			</div>
			<div className="pt-line" />
			{(node.rule || mark) && (
				<div className="pt-rule" data-hot={isHot || undefined} {...hover}>
					<Tex tex={ruleTex(node)} />
				</div>
			)}
			<div className="pt-conc">
				<Tex tex={node.conclusion} />
			</div>
		</div>
	);
}
