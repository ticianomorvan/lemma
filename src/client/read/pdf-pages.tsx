/**
 * The open PDF's pages, drawn by react-pdf (pdf.js) with its text layer so
 * text can be selected. Loaded lazily: pdf.js is the biggest chunk the app
 * has. The file comes from `/files/*`, which pdf.js reads in byte ranges.
 *
 * - Only pages near the screen are drawn; the others keep their place with
 *   the first page's proportions, so long files stay light.
 * - react-pdf suspends while it loads the file and each page, so the file
 *   and every page have their own Suspense boundary: a page coming into view
 *   must not blank the others (and lose the scroll position).
 * - Each drawn text layer is reported to `anchors.ts`, which finds anchors in
 *   it. Passages are painted from there, and a click or hover on one is
 *   matched against its range here.
 */
import "react-pdf/dist/Page/TextLayer.css";
import "./pdf-pages.css";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { cn } from "#lib/utils.ts";
import type { Anchor } from "../../shared/protocol.ts";
import {
	anchorRange,
	layers,
	layersChanged,
	type PagePlace,
	paint,
	placeOf,
	rangeHas,
	restorePlace,
} from "./anchors.ts";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** pdf.js reads only the ranges it needs instead of streaming the whole file. */
const OPTIONS = { disableAutoFetch: true, disableStream: true };

/** A passage to paint and to answer clicks and hovers on. */
export type Mark = { key: string; anchor: Anchor; kind: "question" | "note" };

export function fileUrl(path: string) {
	return `/files/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export default function PdfPages({
	path,
	marks,
	active,
	selected,
	onPassage,
	onHover,
	onPages,
	onPage,
	place,
	onPlace,
	compact = false,
}: {
	/** The file, relative to the study root. */
	path: string;
	marks: Mark[];
	/** The passage being pointed at or read: painted stronger. */
	active?: string;
	/** A selection being drafted into a question or note: kept painted. */
	selected?: Range;
	onPassage?: (key: string) => void;
	onHover?: (key: string | undefined) => void;
	/** The page count, once the file has loaded. */
	onPages?: (count: number) => void;
	/** The page that fills most of the scroller's view, as it changes. */
	onPage?: (page: number) => void;
	/** Where to open the pages, once they are laid out. */
	place?: PagePlace;
	/** Where the reader is: once the pages are laid out (and `place` restored), then as they scroll. */
	onPlace?: (place: PagePlace) => void;
	/** Tighter spacing, for a phone. */
	compact?: boolean;
}) {
	const root = useRef<HTMLDivElement>(null);
	const width = useWidth(root);
	const [count, setCount] = useState(0);
	const [ratio, setRatio] = useState(Math.SQRT2);
	/** The first page is measured, so every page has its final place. */
	const [measured, setMeasured] = useState(false);
	const near = useNearPages(root, width > 0 ? count : 0);
	useKeepPlace(root, width > 0 && measured, place, onPlace);
	useVisiblePage(root, width > 0 ? count : 0, onPage);
	const drawn = useSyncExternalStore(layers.subscribe, layers.version);

	// Highlights: repainted whenever the marks, the active one or a text layer change.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `drawn` repaints
	useEffect(() => {
		const out = {
			questions: [] as Range[],
			notes: [] as Range[],
			active: [] as Range[],
		};
		for (const m of marks) {
			const range = anchorRange(m.anchor);
			if (!range) continue;
			(m.kind === "question" ? out.questions : out.notes).push(range);
			if (m.key === active) out.active.push(range);
		}
		if (selected) out.active.push(selected);
		paint(out);
	}, [marks, active, selected, drawn]);
	useEffect(() => () => paint({ questions: [], notes: [], active: [] }), []);

	const hit = useCallback(
		(x: number, y: number) =>
			marks.find((m) => {
				const range = anchorRange(m.anchor);
				return range && rangeHas(range, x, y);
			})?.key,
		[marks],
	);

	// Hover: at most one hit test a frame.
	const frame = useRef(0);
	const over = useRef<string | undefined>(undefined);
	const onPointerMove = (e: React.PointerEvent) => {
		if (!onHover || e.pointerType !== "mouse" || frame.current) return;
		const { clientX, clientY } = e;
		frame.current = requestAnimationFrame(() => {
			frame.current = 0;
			const key = hit(clientX, clientY);
			if (key === over.current) return;
			over.current = key;
			root.current?.toggleAttribute("data-over-passage", !!key);
			onHover(key);
		});
	};
	const onPointerLeave = () => {
		cancelAnimationFrame(frame.current);
		frame.current = 0;
		if (over.current === undefined) return;
		over.current = undefined;
		root.current?.removeAttribute("data-over-passage");
		onHover?.(undefined);
	};

	const file = useMemo(() => fileUrl(path), [path]);
	return (
		// A highlight is a pointer shortcut to its cards; the cards and pins
		// are the keyboard path, so the page itself takes no focus.
		// biome-ignore lint/a11y/useKeyWithClickEvents: see above
		// biome-ignore lint/a11y/noStaticElementInteractions: see above
		<div
			ref={root}
			data-pdf
			className="pdf-pages"
			onPointerMove={onPointerMove}
			onPointerLeave={onPointerLeave}
			onClick={(e) => {
				// A click that ends a selection is the selection's.
				if (getSelection()?.toString()) return;
				const key = hit(e.clientX, e.clientY);
				if (key) onPassage?.(key);
			}}
		>
			<Suspense fallback={<PageSkeleton ratio={ratio} width={width} />}>
				<Document
					file={file}
					options={OPTIONS}
					onLoadSuccess={async (pdf) => {
						setCount(pdf.numPages);
						onPages?.(pdf.numPages);
						try {
							const first = await pdf.getPage(1);
							const { width: w, height: h } = first.getViewport({ scale: 1 });
							if (w > 0) setRatio(h / w);
						} finally {
							setMeasured(true);
						}
					}}
					error={
						<p
							role="alert"
							className="py-16 text-center text-sm text-muted-foreground"
						>
							No se pudo abrir este PDF.
						</p>
					}
					className={cn("grid", compact ? "gap-3" : "gap-6")}
				>
					{width > 0 &&
						Array.from({ length: count }, (_, i) => {
							const n = i + 1;
							return (
								<section
									key={n}
									data-page={n}
									aria-label={`Página ${n}`}
									className="pdf-page relative overflow-hidden rounded-[3px] shadow-sm"
									style={{ minHeight: near.has(n) ? undefined : width * ratio }}
								>
									{near.has(n) && (
										<Suspense
											fallback={<div style={{ height: width * ratio }} />}
										>
											<Page
												pageNumber={n}
												width={width}
												renderAnnotationLayer={false}
												onRenderTextLayerSuccess={layersChanged}
											/>
										</Suspense>
									)}
								</section>
							);
						})}
				</Document>
			</Suspense>
		</div>
	);
}

function PageSkeleton({ ratio, width }: { ratio: number; width: number }) {
	return (
		<div
			aria-busy
			className="animate-pulse rounded-[3px] bg-card shadow-sm"
			style={{ height: (width || 600) * ratio }}
		/>
	);
}

/** The element's content width, in whole pixels. */
function useWidth(el: React.RefObject<HTMLElement | null>) {
	const [width, setWidth] = useState(0);
	useEffect(() => {
		const node = el.current;
		if (!node) return;
		const observer = new ResizeObserver(([entry]) => {
			const w = Math.floor(entry?.contentRect.width ?? 0);
			setWidth((old) => (Math.abs(old - w) >= 1 ? w : old));
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, [el]);
	return width;
}

/** The pages within a screen and a half of the scroller's view. */
function useNearPages(
	root: React.RefObject<HTMLElement | null>,
	count: number,
) {
	const [near, setNear] = useState<Set<number>>(() => new Set([1, 2]));
	useEffect(() => {
		const el = root.current;
		if (!el || count === 0) return;
		const scroller = el.closest("[data-pdf-scroller]");
		const observer = new IntersectionObserver(
			(entries) => {
				setNear((old) => {
					const next = new Set(old);
					for (const e of entries) {
						const n = Number((e.target as HTMLElement).dataset.page);
						if (e.isIntersecting) next.add(n);
						else next.delete(n);
					}
					return same(old, next) ? old : next;
				});
			},
			{ root: scroller, rootMargin: "150% 0px" },
		);
		for (const page of el.querySelectorAll("[data-page]"))
			observer.observe(page);
		return () => observer.disconnect();
	}, [root, count]);
	// A page that leaves takes its text layer, and its anchors, with it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: on every change
	useEffect(() => layersChanged(), [near]);
	return near;
}

/**
 * Opens the pages at `place` once they are laid out, and holds it there
 * until the reader does anything (scrolls, taps, clicks or types). Reports the reader's place: once right away, then
 * as they scroll. Nothing is reported before that, so the top of the file
 * doesn't overwrite a place still to come.
 */
function useKeepPlace(
	root: React.RefObject<HTMLElement | null>,
	ready: boolean,
	place?: PagePlace,
	onPlace?: (place: PagePlace) => void,
) {
	const initial = useRef(place);
	const report = useRef(onPlace);
	report.current = onPlace;
	useEffect(() => {
		const el = root.current;
		const scroller = el?.closest("[data-pdf-scroller]");
		if (!ready || !el || !scroller) return;
		// The place is held while the pages settle (pages drawing, the width
		// changing as a scrollbar appears), until the reader does anything.
		let held = initial.current;
		initial.current = undefined;
		const hold = () => !!held && restorePlace(scroller, held);
		const release = () => {
			held = undefined;
		};
		const input = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
		for (const e of input) {
			window.addEventListener(e, release, { capture: true, passive: true });
		}
		let frame = 0;
		let tries = 0;
		const onScroll = () => {
			frame ||= requestAnimationFrame(() => {
				frame = 0;
				const now = placeOf(scroller);
				if (now) report.current?.(now);
			});
		};
		const observer = new ResizeObserver(() => {
			if (held) hold();
		});
		const restore = () => {
			// The pages render a frame after they are laid out.
			if (held && !hold() && tries++ < 10) {
				frame = requestAnimationFrame(restore);
				return;
			}
			frame = 0;
			const now = placeOf(scroller);
			if (now) report.current?.(now);
			scroller.addEventListener("scroll", onScroll, { passive: true });
			observer.observe(el);
		};
		frame = requestAnimationFrame(restore);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			scroller.removeEventListener("scroll", onScroll);
			for (const e of input) {
				window.removeEventListener(e, release, { capture: true });
			}
		};
	}, [root, ready]);
}

/** Reports the page that fills most of the scroller's view. */
function useVisiblePage(
	root: React.RefObject<HTMLElement | null>,
	count: number,
	onPage?: (page: number) => void,
) {
	const report = useRef(onPage);
	report.current = onPage;
	useEffect(() => {
		const el = root.current;
		if (!el || count === 0) return;
		const shown = new Map<number, number>();
		let last = 0;
		const observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					const n = Number((e.target as HTMLElement).dataset.page);
					shown.set(n, e.intersectionRect.height);
				}
				let best = 0;
				let most = 0;
				for (const [n, h] of shown) {
					if (h > most) {
						most = h;
						best = n;
					}
				}
				if (best && best !== last) {
					last = best;
					report.current?.(best);
				}
			},
			{
				root: el.closest("[data-pdf-scroller]"),
				threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
			},
		);
		for (const page of el.querySelectorAll("[data-page]"))
			observer.observe(page);
		return () => observer.disconnect();
	}, [root, count]);
}

function same(a: Set<number>, b: Set<number>) {
	if (a.size !== b.size) return false;
	for (const n of a) if (!b.has(n)) return false;
	return true;
}
