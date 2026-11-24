/**
 * The fixture "PDF": pages drawn as HTML with selectable text, standing in
 * for react-pdf's canvas plus text layer (step 8). Passages with anchors are
 * highlighted, and a selection anywhere on a page offers Ask and Note.
 */
import { MessageSquarePlus, StickyNote } from "lucide-react";
import {
	Fragment,
	type ReactNode,
	type RefObject,
	useEffect,
	useState,
} from "react";
import { cn } from "#lib/utils.ts";
import type { Anchor } from "../../../shared/protocol.ts";
import { Tex } from "../../blocks/tex.tsx";
import {
	PAGE_COUNT,
	PAGES,
	PASSAGES,
	PDF_NAME,
	PDF_PATH,
	type Run,
} from "./fixture.ts";

/** How a passage is marked: questions fill it, notes underline it. */
export type Mark = {
	questions: number;
	notes: number;
	active: boolean;
	/** Rendered at the passage's end (the inline pin style). */
	after?: ReactNode;
};

/** Inline Markdown on a page: `$math$`, `**bold**` and `*italic*`. */
export function Rich({ text }: { text: string }) {
	const parts = text.split(/(\$[^$]+\$|\*\*[^*]+\*\*|\*[^*]+\*)/);
	return (
		<>
			{parts.map((p, i) => {
				const key = `${i}:${p}`;
				if (p.startsWith("$") && p.length > 1)
					return <Tex key={key} tex={p.slice(1, -1)} />;
				if (p.startsWith("**"))
					return <strong key={key}>{p.slice(2, -2)}</strong>;
				if (p.startsWith("*") && p.length > 1)
					return <em key={key}>{p.slice(1, -1)}</em>;
				return <Fragment key={key}>{p}</Fragment>;
			})}
		</>
	);
}

export function Pages({
	marks,
	onPassage,
	onHover,
	compact = false,
}: {
	marks: Map<string, Mark>;
	onPassage?: (id: string) => void;
	onHover?: (id: string | undefined) => void;
	/** Tighter padding, for a phone or a drawer. */
	compact?: boolean;
}) {
	return (
		<div className={cn("grid", compact ? "gap-3" : "gap-6")}>
			{PAGES.map((page) => (
				<article
					key={page.n}
					data-page={page.n}
					aria-label={`Página ${page.n}`}
					className={cn(
						"pdf-page relative bg-paper font-heading text-foreground shadow-sm",
						compact
							? "rounded-sm px-5 pt-6 pb-5 text-[15px] leading-[1.6]"
							: "rounded-[3px] px-[clamp(20px,6%,52px)] pt-11 pb-9 text-[15.5px] leading-[1.62]",
					)}
				>
					<div className="mb-6 flex justify-between gap-4 font-sans text-[11px] tracking-[0.02em] text-subtle">
						<span className="truncate">
							Introducción a la Lógica y la Computación
						</span>
						<span className="shrink-0">Apunte 3 · Deducción natural</span>
					</div>
					{page.paras.map((para, i) => {
						const key = `${page.n}-${i}`;
						if (para.kind === "h")
							return (
								<h2
									key={key}
									className="mb-3 text-[19px] leading-snug font-semibold"
								>
									{para.text}
								</h2>
							);
						if (para.kind === "rule")
							return (
								<div key={key} className="my-4 overflow-x-auto text-center">
									<Tex tex={para.tex} display />
								</div>
							);
						return (
							<p
								key={key}
								className={cn(
									"mb-3",
									para.kind === "exercise" && "border-l-2 border-input pl-3",
								)}
							>
								{para.runs.map((run, j) => (
									<RunView
										// biome-ignore lint/suspicious/noArrayIndexKey: a fixed page
										key={`${key}-${j}`}
										run={run}
										marks={marks}
										onPassage={onPassage}
										onHover={onHover}
									/>
								))}
							</p>
						);
					})}
					<div className="mt-6 text-center font-sans text-[11px] text-subtle tabular-nums">
						{page.n}
					</div>
				</article>
			))}
		</div>
	);
}

function RunView({
	run,
	marks,
	onPassage,
	onHover,
}: {
	run: Run;
	marks: Map<string, Mark>;
	onPassage?: (id: string) => void;
	onHover?: (id: string | undefined) => void;
}) {
	if (typeof run === "string") return <Rich text={run} />;
	const passage = PASSAGES.find((p) => p.id === run.passage);
	if (!passage) return null;
	const mark = marks.get(passage.id);
	if (!mark) {
		return (
			<span data-passage={passage.id}>
				<Rich text={passage.tex} />
			</span>
		);
	}
	return (
		// A highlight is a mouse shortcut to its cards; the cards and pins are
		// the keyboard path, so the span itself takes no focus.
		// biome-ignore lint/a11y/useKeyWithClickEvents: see above
		// biome-ignore lint/a11y/noStaticElementInteractions: see above
		<span
			data-passage={passage.id}
			data-active={mark.active || undefined}
			data-kind={mark.questions > 0 ? "question" : "note"}
			onClick={(e) => {
				// A click that ends a selection is the selection's, not the mark's.
				if (getSelection()?.toString()) return;
				e.stopPropagation();
				onPassage?.(passage.id);
			}}
			onPointerEnter={() => onHover?.(passage.id)}
			onPointerLeave={() => onHover?.(undefined)}
			className="passage-mark cursor-pointer"
		>
			<Rich text={passage.tex} />
			{mark.after}
		</span>
	);
}

/** The page most of the reading surface shows, for the header's "p. 12" and the phone strip. */
export function useVisiblePage(scroller: RefObject<HTMLElement | null>) {
	const [page, setPage] = useState(PAGES[0]?.n ?? 1);
	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const ratios = new Map<number, number>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					ratios.set(
						Number((e.target as HTMLElement).dataset.page),
						e.intersectionRect.height,
					);
				}
				let best = 0;
				let most = -1;
				for (const [n, h] of ratios) {
					if (h > most) {
						most = h;
						best = n;
					}
				}
				if (best) setPage(best);
			},
			{ root: el, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
		);
		for (const p of el.querySelectorAll("[data-page]")) observer.observe(p);
		return () => observer.disconnect();
	}, [scroller]);
	return page;
}

export const pageLabel = (page: number) =>
	`${PDF_NAME} · p. ${page} de ${PAGE_COUNT}`;

// ── Selection → Ask / Note ───────────────────────────────────────────────────

/** Ranges of selections asked about that aren't fixture passages, drawn with the CSS Highlight API. */
const ranges = new Map<string, Range>();

export const selectionKey = (anchor: Anchor) =>
	`sel:${anchor.page}:${anchor.text}`;

export function rangeOf(anchor: Anchor) {
	return ranges.get(selectionKey(anchor));
}

function paintRanges() {
	if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
	CSS.highlights.set("lemma-anchor", new Highlight(...ranges.values()));
}

export function keepRange(anchor: Anchor, range: Range) {
	ranges.set(selectionKey(anchor), range);
	paintRanges();
}

type Pending = { anchor: Anchor; range: Range; rect: DOMRect };

/**
 * A floating "Preguntar · Nota" bar over a selection inside `root`. On a
 * touch screen it sits below the selection, clear of the system's own menu.
 */
export function SelectionActions({
	root,
	onAsk,
	onNote,
}: {
	root: RefObject<HTMLElement | null>;
	onAsk: (anchor: Anchor, range: Range) => void;
	onNote: (anchor: Anchor, range: Range) => void;
}) {
	const [pending, setPending] = useState<Pending>();

	useEffect(() => {
		let frame = 0;
		const read = () => {
			frame = 0;
			const sel = getSelection();
			const text = sel?.toString().replace(/\s+/g, " ").trim();
			if (!sel || !text || sel.rangeCount === 0) return setPending(undefined);
			const range = sel.getRangeAt(0);
			const node = range.commonAncestorContainer;
			const el = node instanceof Element ? node : node.parentElement;
			const page = el?.closest<HTMLElement>("[data-page]");
			if (!page || !root.current?.contains(page)) return setPending(undefined);
			setPending({
				anchor: { path: PDF_PATH, page: Number(page.dataset.page), text },
				range: range.cloneRange(),
				rect: range.getBoundingClientRect(),
			});
		};
		const onChange = () => {
			frame ||= requestAnimationFrame(read);
		};
		const onScroll = () => setPending(undefined);
		document.addEventListener("selectionchange", onChange);
		root.current?.addEventListener("scroll", onScroll, { passive: true });
		const el = root.current;
		return () => {
			document.removeEventListener("selectionchange", onChange);
			el?.removeEventListener("scroll", onScroll);
			cancelAnimationFrame(frame);
		};
	}, [root]);

	if (!pending) return null;
	const touch = matchMedia("(pointer: coarse)").matches;
	const { rect } = pending;
	const top = touch ? rect.bottom + 10 : rect.top - 44;
	const left = Math.min(
		Math.max(8, rect.left + rect.width / 2 - 96),
		innerWidth - 200,
	);
	const act = (fn: typeof onAsk) => () => {
		fn(pending.anchor, pending.range);
		getSelection()?.removeAllRanges();
		setPending(undefined);
	};
	return (
		<div
			role="toolbar"
			aria-label="Selección"
			style={{ top: Math.max(8, top), left }}
			className={cn(
				"select-pop fixed z-40 flex items-center gap-0.5 rounded-full bg-foreground p-1 text-background shadow-lg",
				touch ? "origin-top" : "origin-bottom",
			)}
			// Keep the selection while pressing.
			onPointerDown={(e) => e.preventDefault()}
		>
			<button
				type="button"
				onClick={act(onAsk)}
				className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-[background-color,transform] duration-150 ease-out hover:bg-background/15 active:scale-[0.97]"
			>
				<MessageSquarePlus aria-hidden className="size-4" />
				Preguntar
			</button>
			<button
				type="button"
				onClick={act(onNote)}
				className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-[background-color,transform] duration-150 ease-out hover:bg-background/15 active:scale-[0.97]"
			>
				<StickyNote aria-hidden className="size-4" />
				Nota
			</button>
		</div>
	);
}
