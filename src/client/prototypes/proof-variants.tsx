import { useState } from "react";
import type { ProofNode } from "../blocks/schema.ts";
import { Tex } from "../blocks/tex.tsx";

const leafTex = (n: ProofNode) =>
	n.discharged && !n.premises
		? `[${n.conclusion}]^{${n.discharged}}`
		: n.conclusion;
const ruleTex = (n: ProofNode) =>
	n.rule ? `${n.rule}${n.discharged ? `^{${n.discharged}}` : ""}` : "";

/** Clásico: the textbook Gentzen tree, hairline rules, labels to the right. */
export function ProofClassic({ proof }: { proof: ProofNode }) {
	return (
		<div className="pv-scroll">
			<div className="pt-classic">
				<ClassicNode node={proof} />
			</div>
		</div>
	);
}

function ClassicNode({ node }: { node: ProofNode }) {
	if (!node.premises) {
		return (
			<div className="pt-node">
				<div className="pt-conc">
					<Tex tex={leafTex(node)} />
				</div>
			</div>
		);
	}
	return (
		<div className="pt-node">
			<div className="pt-premises">
				{node.premises.map((p, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static tree
					<ClassicNode key={i} node={p} />
				))}
			</div>
			<div className="pt-line" />
			<div className="pt-rule">
				<Tex tex={ruleTex(node)} />
			</div>
			<div className="pt-conc">
				<Tex tex={node.conclusion} />
			</div>
		</div>
	);
}

/**
 * Tarjeta: the same tree on a paper card with a header; rules are tinted,
 * discharged assumptions and the rule that discharges them share a colour,
 * and hovering a label lights up its pair.
 */
export function ProofCard({
	proof,
	title,
}: {
	proof: ProofNode;
	title: string;
}) {
	const [hot, setHot] = useState<string | null>(null);
	return (
		<figure className="pv-card">
			<figcaption className="pv-card-head">
				<span className="pv-chip">{title}</span>
				<span className="pv-hint">Pasá por un número para ver qué descarga</span>
			</figcaption>
			<div className="pv-scroll">
				<div className="pt-classic pt-card">
					<CardNode node={proof} hot={hot} setHot={setHot} />
				</div>
			</div>
		</figure>
	);
}

function CardNode({
	node,
	hot,
	setHot,
}: {
	node: ProofNode;
	hot: string | null;
	setHot: (v: string | null) => void;
}) {
	const mark = node.discharged;
	const hover = mark
		? {
				onPointerEnter: () => setHot(mark),
				onPointerLeave: () => setHot(null),
			}
		: {};
	if (!node.premises) {
		return (
			<div className="pt-node">
				<div
					className="pt-conc pt-leaf"
					data-discharged={mark ? "" : undefined}
					data-hot={mark && hot === mark ? "" : undefined}
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
					// biome-ignore lint/suspicious/noArrayIndexKey: static tree
					<CardNode key={i} node={p} hot={hot} setHot={setHot} />
				))}
			</div>
			<div className="pt-line" />
			<div
				className="pt-rule pt-rule-chip"
				data-hot={mark && hot === mark ? "" : undefined}
				{...hover}
			>
				<Tex tex={ruleTex(node)} />
			</div>
			<div className="pt-conc">
				<Tex tex={node.conclusion} />
			</div>
		</div>
	);
}

/**
 * Guiado: the tree read top-down as an outline, conclusion first, each step
 * naming its rule; it never scrolls sideways, so it suits a phone.
 */
export function ProofOutline({ proof }: { proof: ProofNode }) {
	return (
		<div className="pv-outline">
			<OutlineNode node={proof} root />
		</div>
	);
}

function OutlineNode({ node, root }: { node: ProofNode; root?: boolean }) {
	const leaf = !node.premises;
	return (
		<div className="po-node" data-root={root || undefined}>
			<div className="po-row">
				<Tex tex={leaf ? leafTex(node) : node.conclusion} />
				<span className="po-rule">
					{leaf ? (
						node.discharged ? (
							<>
								supuesto <Tex tex={`^{${node.discharged}}`} />
							</>
						) : (
							"premisa"
						)
					) : (
						<>
							por <Tex tex={ruleTex(node)} />
						</>
					)}
				</span>
			</div>
			{node.premises && node.premises.length > 0 && (
				<div className="po-children">
					{node.premises.map((p, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static tree
						<OutlineNode key={i} node={p} />
					))}
				</div>
			)}
		</div>
	);
}
