/**
 * `fitch`: numbered lines with each subproof as a tinted band, and the
 * assumption that opens it marked by its justification.
 */
import { type Fitch as FitchProof, fitchSchema, parseBlock } from "./schema.ts";
import { Tex } from "./tex.tsx";

export default function Fitch({ source }: { source: string }) {
	const fitch = parseBlock(fitchSchema, source);
	return (
		<div className="block-scroll">
			<div className="fk">
				{lines(fitch).map((l) => (
					<div key={l.n} className="fk-row" data-opens={l.opens || undefined}>
						<span className="fk-n">{l.n}</span>
						{Array.from({ length: l.depth }, (_, d) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: one band per depth
							<span key={d} className="fk-band" data-d={d % 3} />
						))}
						<span className="fk-f">
							<Tex tex={l.formula} />
						</span>
						<span className="fk-j">
							{l.justification && <Tex tex={l.justification} />}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

/** Numbers each line and marks the ones that open a subproof. */
function lines(fitch: FitchProof) {
	return fitch.lines.map((l, i) => {
		const prev = fitch.lines[i - 1];
		const opens = l.assumption ?? (prev ? l.depth > prev.depth : l.depth > 0);
		return { ...l, n: i + 1, opens };
	});
}
