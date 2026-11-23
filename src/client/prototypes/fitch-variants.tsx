import { useState } from "react";
import type { Fitch } from "../blocks/schema.ts";
import { Tex } from "../blocks/tex.tsx";

type Line = Fitch["lines"][number] & { n: number; opens: boolean };

/** Numbers each line and marks the ones that open a subproof. */
function lines(fitch: Fitch): Line[] {
	return fitch.lines.map((l, i) => {
		const prev = fitch.lines[i - 1];
		const opens = l.assumption ?? (prev ? l.depth > prev.depth : l.depth > 0);
		return { ...l, n: i + 1, opens };
	});
}

/** Clásico: numbers, continuous scope bars, a bar under each assumption. */
export function FitchClassic({ fitch }: { fitch: Fitch }) {
	return (
		<div className="pv-scroll">
			<div className="fc">
				{lines(fitch).map((l) => (
					<div key={l.n} className="fc-row">
						<span className="fc-n">{l.n}</span>
						{Array.from({ length: l.depth + 1 }, (_, d) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: bars by depth
							<span key={d} className="fc-bar" />
						))}
						<span className="fc-f" data-opens={l.opens || undefined}>
							<Tex tex={l.formula} />
						</span>
						<span className="fc-j">
							{l.justification && <Tex tex={l.justification} />}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

/** Tarjeta: each subproof a tinted band, assumptions as chips, on a card. */
export function FitchCard({ fitch }: { fitch: Fitch }) {
	return (
		<figure className="pv-card">
			<figcaption className="pv-card-head">
				<span className="pv-chip">Fitch</span>
			</figcaption>
			<div className="pv-scroll">
				<div className="fk">
					{lines(fitch).map((l) => (
						<div key={l.n} className="fk-row">
							<span className="fk-n">{l.n}</span>
							{Array.from({ length: l.depth }, (_, d) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: bands by depth
								<span key={d} className="fk-band" data-d={d} />
							))}
							<span className="fk-f">
								<Tex tex={l.formula} />
							</span>
							<span className="fk-j" data-opens={l.opens || undefined}>
								{l.justification && <Tex tex={l.justification} />}
							</span>
						</div>
					))}
				</div>
			</div>
		</figure>
	);
}

/** Cited line numbers: `1, 3` and ranges `3–5`. */
function cites(justification = ""): number[] {
	const text = justification.replace(/\\text\{–\}/g, "–");
	const out: number[] = [];
	for (const m of text.matchAll(/(\d+)\s*(?:[–-]\s*(\d+))?/g)) {
		const a = Number(m[1]);
		const b = m[2] ? Number(m[2]) : a;
		for (let i = a; i <= b; i++) out.push(i);
	}
	return out;
}

/**
 * Guiado: justification under the formula so nothing scrolls on a phone;
 * tapping or hovering a line lights up the lines it cites.
 */
export function FitchGuided({ fitch }: { fitch: Fitch }) {
	const all = lines(fitch);
	const [hot, setHot] = useState<number | null>(null);
	const cited = new Set(hot ? cites(all[hot - 1]?.justification) : []);
	return (
		<div className="fg">
			{all.map((l) => (
				<button
					type="button"
					key={l.n}
					className="fg-row"
					data-hot={hot === l.n || undefined}
					data-cited={cited.has(l.n) || undefined}
					onPointerEnter={() => setHot(l.n)}
					onPointerLeave={() => setHot(null)}
					onFocus={() => setHot(l.n)}
					onBlur={() => setHot(null)}
				>
					<span className="fg-n">{l.n}</span>
					{Array.from({ length: l.depth + 1 }, (_, d) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: bars by depth
						<span key={d} className="fc-bar" />
					))}
					<span className="fg-body" data-opens={l.opens || undefined}>
						<Tex tex={l.formula} />
						<span className="fg-j">
							{l.justification && <Tex tex={l.justification} />}
						</span>
					</span>
				</button>
			))}
		</div>
	);
}
