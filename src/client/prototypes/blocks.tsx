/**
 * Step 6 prototype: three directions for the `proof`, `fitch` and `plot`
 * blocks, inside a notebook cell, behind the variant picker. Served from the
 * build at /prototypes/blocks.html. `?v=1..3`, `?theme=light|dark`.
 */
import "../globals.css";
import "./blocks.css";
import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Markdown } from "../markdown/markdown.tsx";
import {
	binomial,
	contraposition,
	contrapositionFitch,
	excludedMiddle,
	normalTail,
} from "./content.ts";
import { FitchCard, FitchClassic, FitchGuided } from "./fitch-variants.tsx";
import { PlotAnnotated, PlotCard, PlotCardSvg, PlotClassic } from "./plot-variants.tsx";
import { ProofCard, ProofClassic, ProofOutline } from "./proof-variants.tsx";

const VARIANTS = [
	{
		name: "Clásico",
		proof: () => <ProofClassic proof={contraposition} />,
		sequent: () => <ProofClassic proof={excludedMiddle} />,
		fitch: () => <FitchClassic fitch={contrapositionFitch} />,
		plot: () => <PlotClassic plot={normalTail} />,
		pmf: () => <PlotClassic plot={binomial} />,
	},
	{
		name: "Mafs",
		proof: () => <ProofCard proof={contraposition} title="Deducción natural" />,
		sequent: () => <ProofCard proof={excludedMiddle} title="Cálculo de secuentes" />,
		fitch: () => <FitchCard fitch={contrapositionFitch} />,
		plot: () => <PlotCard plot={normalTail} title="Normal estándar" />,
		pmf: () => <PlotCard plot={binomial} title="Binomial(5; 0,4)" />,
	},
	{
		name: "SVG",
		proof: () => <ProofCard proof={contraposition} title="Deducción natural" />,
		sequent: () => <ProofCard proof={excludedMiddle} title="Cálculo de secuentes" />,
		fitch: () => <FitchCard fitch={contrapositionFitch} />,
		plot: () => <PlotCardSvg plot={normalTail} title="Normal estándar" />,
		pmf: () => <PlotCardSvg plot={binomial} title="Binomial(5; 0,4)" />,
	},
	{
		name: "Guiado",
		proof: () => <ProofOutline proof={contraposition} />,
		sequent: () => <ProofOutline proof={excludedMiddle} />,
		fitch: () => <FitchGuided fitch={contrapositionFitch} />,
		plot: () => <PlotAnnotated plot={normalTail} />,
		pmf: () => <PlotAnnotated plot={binomial} />,
	},
] as const;

function Cell({ q, children }: { q: string; children: React.ReactNode }) {
	return (
		<section className="border-t py-6 first:border-t-0 first:pt-0">
			<div className="rounded-xl border bg-card px-4 py-3 shadow-sm">
				<div className="answer question">
					<Markdown text={q} question />
				</div>
			</div>
			<div className="mt-5 grid gap-2 [&_.answer]:text-[16px]">{children}</div>
		</section>
	);
}

const P = ({ md }: { md: string }) => (
	<div className="answer min-w-0">
		<Markdown text={md} />
	</div>
);

function Page({ v }: { v: number }) {
	const V = VARIANTS[v] ?? VARIANTS[0];
	return (
		<div className="min-h-dvh bg-paper">
			<div className="mx-auto max-w-[720px] px-4 pt-6 pb-28 sm:px-8 sm:pt-8">
				<Cell q="Derivá $(p\to q)\to(\neg q\to\neg p)$ por deducción natural.">
					<P md="Suponemos $p\to q$, después $\neg q$, y buscamos $\neg p$ por reducción al absurdo: con $p$ sale $q$, que choca con $\neg q$." />
					<div className="min-w-0">{V.proof()}</div>
					<P md="Cada supuesto entre corchetes se descarga en la regla con el mismo número." />
				</Cell>
				<Cell q="La misma prueba en estilo Fitch.">
					<div className="min-w-0">{V.fitch()}</div>
				</Cell>
				<Cell q="Probá $\vdash p\lor\neg p$ en el cálculo de secuentes.">
					<div className="min-w-0">{V.sequent()}</div>
				</Cell>
				<Cell q="Graficá la densidad normal y sombreá $P(X>1{,}5)$.">
					<P md="Para $X\sim N(0,1)$, $P(X>1{,}5)=1-\Phi(1{,}5)\approx 0{,}0668$: el área sombreada a la derecha de $1{,}5$." />
					<div className="min-w-0">{V.plot()}</div>
				</Cell>
				<Cell q="Función de probabilidad y de distribución de una $\mathrm{Bin}(5;\,0{,}4)$.">
					<div className="min-w-0">{V.pmf()}</div>
				</Cell>
			</div>
		</div>
	);
}

/** The prototype picker, verbatim from the `ui` skill's PICKER.md. */
function Picker({ v, setV }: { v: number; setV: (i: number) => void }) {
	const nav = useRef<HTMLElement>(null);
	const hl = useRef<HTMLSpanElement>(null);
	const items = useRef<(HTMLButtonElement | null)[]>([]);
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		const move = () => {
			const el = items.current[v];
			if (!el || !hl.current) return;
			hl.current.style.width = `${el.offsetWidth}px`;
			hl.current.style.transform = `translateX(${el.offsetLeft}px)`;
		};
		move();
		window.addEventListener("resize", move);
		return () => window.removeEventListener("resize", move);
	}, [v]);
	useEffect(() => {
		requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
	}, []);
	return (
		<nav ref={nav} className="proto-picker" aria-label="Prototype variants" data-ready={ready || undefined}>
			<span ref={hl} className="proto-picker-highlight" aria-hidden="true" />
			{VARIANTS.map((x, i) => (
				<button
					type="button"
					key={x.name}
					ref={(el) => {
						items.current[i] = el;
					}}
					className="proto-picker-item"
					data-active={i === v || undefined}
					aria-current={i === v ? "true" : undefined}
					onClick={() => setV(i)}
				>
					{x.name}
				</button>
			))}
			<span className="proto-picker-divider" aria-hidden="true" />
			<button
				type="button"
				className="proto-picker-item proto-picker-replay"
				aria-label="Cambiar tema"
				onClick={() => {
					const root = document.documentElement;
					const dark =
						root.dataset.theme === "dark" ||
						(!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
					root.dataset.theme = dark ? "light" : "dark";
				}}
			>
				◐
			</button>
		</nav>
	);
}

function App() {
	const initial = Number(new URLSearchParams(location.search).get("v"));
	const [v, setVState] = useState(initial >= 1 && initial <= VARIANTS.length ? initial - 1 : 0);
	const setV = (i: number) => {
		if (i < 0 || i >= VARIANTS.length) return;
		setVState(i);
		const url = new URL(location.href);
		url.searchParams.set("v", String(i + 1));
		history.replaceState(null, "", url);
	};
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement;
			if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const n = Number.parseInt(e.key, 10);
			if (n >= 1 && n <= VARIANTS.length) setV(n - 1);
			else if (e.key === "ArrowRight") setV((v + 1) % VARIANTS.length);
			else if (e.key === "ArrowLeft") setV((v - 1 + VARIANTS.length) % VARIANTS.length);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	});
	return (
		<>
			<Page key={v} v={v} />
			<Picker v={v} setV={setV} />
		</>
	);
}

const theme = new URLSearchParams(location.search).get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
