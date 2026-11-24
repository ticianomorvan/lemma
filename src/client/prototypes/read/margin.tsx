/**
 * The margin beside the page (chat closed) and the gutter pins (chat open).
 * Both place one box per passage, or per item, at the passage's height and
 * push a box down when the one above would overlap it.
 */
import { ArrowUpRight, ChevronDown, StickyNote, X } from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#components/ui/popover.tsx";
import { cn } from "#lib/utils.ts";
import type { Anchor } from "../../../shared/protocol.ts";
import { Markdown } from "../../markdown/lazy.tsx";
import { snippet } from "../../thread/model.ts";
import { TurnBlocks } from "../../thread/parts.tsx";
import { anchorRect, type Group, type Item, preview, stack } from "./items.ts";

// ── Layout ───────────────────────────────────────────────────────────────────

type Unit = { key: string; rect: () => DOMRect | undefined };

/**
 * Where each unit goes in a column: its passage's top, relative to the
 * column, pushed down past the unit above. Re-measured when anything in the
 * column or the page resizes.
 */
function useColumn(
	column: RefObject<HTMLElement | null>,
	units: Unit[],
	gap: number,
) {
	const boxes = useRef(new Map<string, HTMLElement>());
	const [layout, setLayout] = useState<{
		top: Map<string, number>;
		want: Map<string, number>;
		floor: number;
	}>({ top: new Map(), want: new Map(), floor: 0 });
	const [tick, setTick] = useState(0);
	const key = units.map((u) => u.key).join(" ");

	// biome-ignore lint/correctness/useExhaustiveDependencies: `tick` re-measures
	useLayoutEffect(() => {
		const col = column.current;
		if (!col) return;
		const base = col.getBoundingClientRect().top;
		const want = new Map<string, number>();
		const wants = units.flatMap((u) => {
			const r = u.rect();
			const box = boxes.current.get(u.key);
			if (!r || !box) return [];
			const top = r.top - base - 6;
			want.set(u.key, r.top - base);
			return [{ key: u.key, top, height: box.offsetHeight }];
		});
		const top = stack(wants, gap);
		let floor = 0;
		for (const w of wants) {
			floor = Math.max(floor, (top.get(w.key) ?? 0) + w.height);
		}
		setLayout((old) =>
			same(old.top, top) && old.floor === floor ? old : { top, want, floor },
		);
	}, [key, tick, gap]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: observe the boxes `key` names
	useLayoutEffect(() => {
		const col = column.current;
		if (!col) return;
		const observer = new ResizeObserver(() => setTick((t) => t + 1));
		observer.observe(col);
		if (col.parentElement) observer.observe(col.parentElement);
		for (const box of boxes.current.values()) observer.observe(box);
		return () => observer.disconnect();
	}, [column, key]);

	const ref = (k: string) => (el: HTMLElement | null) => {
		if (el) boxes.current.set(k, el);
		else boxes.current.delete(k);
	};
	return { ...layout, ref };
}

function same(a: Map<string, number>, b: Map<string, number>) {
	if (a.size !== b.size) return false;
	for (const [k, v] of a)
		if (Math.abs((b.get(k) ?? -1) - v) > 0.5) return false;
	return true;
}

/** A thin line from a pushed-down box back to its passage. */
function Leader({ from, to }: { from: number; to: number }) {
	if (to - from < 14) return null;
	return (
		<svg
			aria-hidden
			className="pointer-events-none absolute -left-4 w-4 overflow-visible text-input"
			style={{ top: from + 8, height: to - from }}
		>
			<path
				d={`M0 0 C 10 0, 6 ${to - from}, 16 ${to - from + 8}`}
				fill="none"
				stroke="currentColor"
				strokeWidth={1}
			/>
		</svg>
	);
}

// ── The margin ───────────────────────────────────────────────────────────────

export type Draft = { kind: "ask" | "note"; anchor: Anchor; range: Range };

export function Margin({
	groups,
	active,
	onActive,
	onOpenTurn,
	draft,
	onDraftDone,
}: {
	groups: Group[];
	/** The passage being pointed at or read: its cards are emphasised. */
	active?: string;
	onActive: (key: string | undefined) => void;
	onOpenTurn: (turnId: string) => void;
	draft?: Draft;
	onDraftDone: (text: string | null) => void;
}) {
	const column = useRef<HTMLElement>(null);
	const [open, setOpen] = useState<string>();

	const units: Unit[] = groups.map((g) => ({
		key: g.key,
		rect: () => anchorRect(g.anchor),
	}));
	if (draft)
		units.push({
			key: "draft",
			rect: () => draft.range.getBoundingClientRect(),
		});

	const { top, want, floor, ref } = useColumn(column, units, 8);
	const place = (k: string) => ({
		transform: `translateY(${top.get(k) ?? want.get(k) ?? 0}px)`,
		visibility: top.has(k) ? ("visible" as const) : ("hidden" as const),
	});

	const boxes: ReactNode[] = [];
	if (draft) {
		boxes.push(
			<div
				key="draft"
				ref={ref("draft")}
				className="absolute inset-x-0 z-10"
				style={place("draft")}
			>
				<DraftCard draft={draft} onDone={onDraftDone} />
			</div>,
		);
	}
	for (const g of groups) {
		boxes.push(
			<div
				key={g.key}
				ref={ref(g.key)}
				className="absolute inset-x-0"
				style={place(g.key)}
				onPointerEnter={() => onActive(g.key)}
				onPointerLeave={() => onActive(undefined)}
			>
				<GroupCard
					group={g}
					open={open}
					onOpen={setOpen}
					onOpenTurn={onOpenTurn}
					lit={active === g.key}
				/>
			</div>,
		);
	}

	return (
		<section
			ref={column}
			aria-label="Margen: preguntas y notas de la página"
			className="relative w-full"
			style={{ minHeight: floor + 120 }}
		>
			{units.map((u) => {
				const t = top.get(u.key);
				const w = want.get(u.key);
				return t !== undefined && w !== undefined ? (
					<Leader key={`l-${u.key}`} from={w} to={t} />
				) : null;
			})}
			{boxes}
		</section>
	);
}

const badge =
	"grid size-[18px] shrink-0 place-items-center rounded-full bg-primary text-[10.5px] font-semibold text-primary-foreground tabular-nums";

function Head({ item }: { item: Item }) {
	if (item.kind === "note") {
		return (
			<span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-highlight-foreground uppercase dark:text-highlight-foreground">
				<StickyNote aria-hidden className="size-3.5" />
				Nota
			</span>
		);
	}
	return (
		<span className="flex min-w-0 items-center gap-2 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">
			<span className={badge}>{item.n}</span>
			{item.streaming ? (
				<span className="text-primary">Respondiendo</span>
			) : (
				<span>Pregunta</span>
			)}
		</span>
	);
}

/** One question or note. Collapsed it previews; open it shows the whole answer. */
function ItemCard({
	item,
	open,
	onToggle,
	onOpenTurn,
	lit,
}: {
	item: Item;
	open: boolean;
	onToggle: () => void;
	onOpenTurn: (turnId: string) => void;
	lit: boolean;
}) {
	const shell = cn(
		"grid w-full rounded-xl border bg-card text-left shadow-sm transition-[border-color,box-shadow] duration-150 ease-out",
		lit && "border-input shadow-lg",
		item.kind === "note" && "border-l-[3px] border-l-highlight",
	);
	if (item.kind === "note") {
		return (
			<div className={cn(shell, "px-3 py-2.5")}>
				<Head item={item} />
				<p className="mt-1 font-heading text-[14px] leading-snug">
					{item.note.text ?? (
						<span className="text-subtle">Resaltado sin texto</span>
					)}
				</p>
			</div>
		);
	}
	if (!open) {
		return (
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={false}
				className={cn(
					shell,
					"px-3 py-2.5 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-ring",
				)}
			>
				<Head item={item} />
				<div className="answer question mt-1 line-clamp-2 font-sans text-[13.5px] font-medium">
					<Markdown text={item.turn.user.text} question />
				</div>
				<div className="answer mt-1 line-clamp-3 text-[14px] leading-normal text-muted-foreground">
					{item.streaming && !preview(item.turn) ? (
						<span className="thinking-shimmer">Pensando…</span>
					) : (
						<Markdown text={preview(item.turn)} />
					)}
				</div>
			</button>
		);
	}
	return (
		<article className={cn(shell, "border-input px-3 py-2.5 shadow-lg")}>
			<div className="flex items-start justify-between gap-2">
				<Head item={item} />
				<button
					type="button"
					onClick={onToggle}
					aria-expanded
					aria-label="Cerrar"
					className="-mt-1 -mr-1 grid size-7 place-items-center rounded-md text-subtle transition-[color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.97]"
				>
					<X aria-hidden className="size-4" />
				</button>
			</div>
			<div className="answer question mt-1 font-sans text-[13.5px] font-medium">
				<Markdown text={item.turn.user.text} question />
			</div>
			<div className="mt-2 max-h-[min(60dvh,520px)] overflow-y-auto overscroll-contain [&_.answer]:text-[14.5px]">
				<TurnBlocks turn={item.turn} streaming={item.streaming} />
			</div>
			<button
				type="button"
				onClick={() => onOpenTurn(item.turn.id)}
				className="mt-2 inline-flex h-7 items-center gap-1 rounded-md text-[12.5px] font-medium text-primary transition-transform duration-150 ease-out active:scale-[0.97]"
			>
				Seguir en el chat
				<ArrowUpRight aria-hidden className="size-3.5" />
			</button>
		</article>
	);
}

function counts(group: Group) {
	const q = group.items.filter((i) => i.kind === "turn").length;
	const n = group.items.length - q;
	return [
		q && `${q} ${q === 1 ? "pregunta" : "preguntas"}`,
		n && `${n} ${n === 1 ? "nota" : "notas"}`,
	]
		.filter(Boolean)
		.join(" · ");
}

/** Every item on one passage as one card: a pile when closed, a list when open. */
function GroupCard({
	group,
	open,
	onOpen,
	onOpenTurn,
	lit,
}: {
	group: Group;
	open?: string;
	onOpen: (key: string | undefined) => void;
	onOpenTurn: (turnId: string) => void;
	lit: boolean;
}) {
	const [first] = group.items;
	if (!first) return null;
	if (group.items.length === 1) {
		return (
			<ItemCard
				item={first}
				open={open === first.key}
				onToggle={() => onOpen(open === first.key ? undefined : first.key)}
				onOpenTurn={onOpenTurn}
				lit={lit}
			/>
		);
	}
	const expanded =
		group.items.some((i) => i.key === open) || open === group.key;
	const pile =
		"shadow-[0_1px_2px_rgb(0_0_0/0.05),0_5px_0_-2px_var(--card),0_5px_0_-1px_var(--border),0_10px_0_-4px_var(--card),0_10px_0_-3px_var(--border)]";
	if (!expanded) {
		return (
			<button
				type="button"
				onClick={() => onOpen(group.key)}
				aria-expanded={false}
				className={cn(
					"mb-2.5 grid w-full rounded-xl border bg-card px-3 py-2.5 text-left transition-[border-color] duration-150 ease-out active:scale-[0.99]",
					pile,
					lit && "border-input",
				)}
			>
				<span className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">
					<span className="flex -space-x-0.5">
						{group.items.map((i) =>
							i.kind === "turn" ? (
								<span key={i.key} className={cn(badge, "ring-2 ring-card")}>
									{i.n}
								</span>
							) : (
								<span
									key={i.key}
									className="grid size-[18px] place-items-center rounded-full bg-highlight text-highlight-foreground ring-2 ring-card"
								>
									<StickyNote aria-hidden className="size-3" />
								</span>
							),
						)}
					</span>
					{counts(group)}
					<ChevronDown aria-hidden className="ml-auto size-3.5" />
				</span>
				<div className="answer question mt-1.5 line-clamp-2 font-sans text-[13.5px] font-medium">
					<Markdown
						text={
							first.kind === "turn"
								? first.turn.user.text
								: (first.note.text ?? "")
						}
						question
					/>
				</div>
			</button>
		);
	}
	return (
		<div className="grid gap-1.5 rounded-xl border border-input bg-card p-1.5 shadow-lg">
			<button
				type="button"
				onClick={() => onOpen(undefined)}
				className="flex h-7 items-center gap-2 rounded-md px-1.5 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase transition-transform duration-150 ease-out active:scale-[0.99]"
			>
				{counts(group)}
				<ChevronDown aria-hidden className="ml-auto size-3.5 rotate-180" />
			</button>
			{group.items.map((item) => (
				<ItemCard
					key={item.key}
					item={item}
					open={open === item.key}
					onToggle={() => onOpen(open === item.key ? group.key : item.key)}
					onOpenTurn={onOpenTurn}
					lit={false}
				/>
			))}
		</div>
	);
}

function DraftCard({
	draft,
	onDone,
}: {
	draft: Draft;
	onDone: (text: string | null) => void;
}) {
	const [text, setText] = useState("");
	const ask = draft.kind === "ask";
	const input = useRef<HTMLTextAreaElement>(null);
	// The card is hidden until the margin has placed it, and a hidden field
	// can't take focus: focus it on the frame after.
	useEffect(() => {
		const f = requestAnimationFrame(() =>
			requestAnimationFrame(() =>
				input.current?.focus({ preventScroll: true }),
			),
		);
		return () => cancelAnimationFrame(f);
	}, []);
	return (
		<form
			className="turn-in rounded-xl border border-input bg-card p-2.5 shadow-lg"
			onSubmit={(e) => {
				e.preventDefault();
				if (ask && !text.trim()) return;
				onDone(text.trim());
			}}
		>
			<span className="flex items-center gap-1.5 px-0.5 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">
				{ask ? "Nueva pregunta" : "Nueva nota"} · p. {draft.anchor.page}
			</span>
			<p className="mt-1 line-clamp-2 border-l-2 border-highlight pl-2 font-heading text-[13.5px] text-muted-foreground italic">
				{draft.anchor.text}
			</p>
			<textarea
				ref={input}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") onDone(null);
					if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
						e.preventDefault();
						e.currentTarget.form?.requestSubmit();
					}
				}}
				rows={2}
				aria-label={ask ? "Pregunta" : "Nota"}
				placeholder={
					ask ? "¿Qué querés preguntar?" : "Escribí la nota (opcional)…"
				}
				className="mt-2 field-sizing-content max-h-40 min-h-12 w-full resize-none rounded-md bg-secondary px-2 py-1.5 font-heading text-[15px] outline-none placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-ring/40"
			/>
			<div className="mt-2 flex justify-end gap-1.5">
				<button
					type="button"
					onClick={() => onDone(null)}
					className="h-7 rounded-md px-2.5 text-[12.5px] text-muted-foreground transition-transform duration-150 ease-out active:scale-[0.97]"
				>
					Cancelar
				</button>
				<button
					type="submit"
					disabled={ask && !text.trim()}
					className="h-7 rounded-md bg-primary px-2.5 text-[12.5px] font-medium text-primary-foreground transition-[transform,opacity] duration-150 ease-out active:scale-[0.97] disabled:opacity-40"
				>
					{ask ? "Preguntar" : "Guardar"}
				</button>
			</div>
		</form>
	);
}

// ── Pins (chat open) ─────────────────────────────────────────────────────────

/** The gutter beside the page while the chat is open: one bar per passage. */
export function Gutter({
	groups,
	onOpenTurn,
	onActive,
}: {
	groups: Group[];
	onOpenTurn: (turnId: string) => void;
	onActive: (key: string | undefined) => void;
}) {
	const column = useRef<HTMLElement>(null);
	const units = groups.map((g) => ({
		key: g.key,
		rect: () => anchorRect(g.anchor),
	}));
	const { top, want, ref } = useColumn(column, units, 4);
	return (
		<section ref={column} aria-label="Marcadores" className="relative w-9">
			{groups.map((g) => {
				const r = anchorRect(g.anchor);
				const y = top.get(g.key) ?? want.get(g.key) ?? 0;
				return (
					<div
						key={g.key}
						ref={ref(g.key)}
						className="absolute inset-x-0 flex flex-col items-center gap-[3px]"
						style={{
							transform: `translateY(${y}px)`,
							visibility: top.has(g.key) ? "visible" : "hidden",
						}}
						onPointerEnter={() => onActive(g.key)}
						onPointerLeave={() => onActive(undefined)}
					>
						<BarPin
							group={g}
							height={r?.height ?? 24}
							onOpenTurn={onOpenTurn}
						/>
					</div>
				);
			})}
		</section>
	);
}

/** A bar along the passage with its count; several items open a list first. */
function BarPin({
	group,
	height,
	onOpenTurn,
}: {
	group: Group;
	height: number;
	onOpenTurn: (turnId: string) => void;
}) {
	const bar = (
		<>
			<span
				aria-hidden
				className="w-[3px] rounded-full bg-primary/60 transition-[background-color] duration-150 ease-out group-hover/bar:bg-primary"
				style={{ height: Math.max(18, height) }}
			/>
			<span className="absolute -top-1 left-1/2 ml-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10.5px] font-semibold text-primary-foreground tabular-nums">
				{group.items.length}
			</span>
		</>
	);
	const cls =
		"group/bar relative flex w-6 justify-center rounded-md py-0.5 transition-transform duration-150 ease-out active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-ring";
	const [only] = group.items;
	if (group.items.length === 1 && only?.kind === "turn") {
		return (
			<button
				type="button"
				className={cls}
				aria-label={`Ir a la pregunta ${only.n}`}
				onClick={() => onOpenTurn(only.turn.id)}
			>
				{bar}
			</button>
		);
	}
	return (
		<Popover>
			<PopoverTrigger
				className={cls}
				aria-label={`${group.items.length} en este pasaje`}
			>
				{bar}
			</PopoverTrigger>
			<PopoverContent side="left" align="start" className="w-72 gap-0 p-1">
				{group.items.map((item) =>
					item.kind === "turn" ? (
						<button
							key={item.key}
							type="button"
							onClick={() => onOpenTurn(item.turn.id)}
							className="flex w-full items-baseline gap-2 rounded-md px-2 py-2 text-left text-[13.5px] hover:bg-secondary"
						>
							<span className={badge}>{item.n}</span>
							<span className="line-clamp-2 min-w-0">
								{snippet(item.turn.user.text)}
							</span>
						</button>
					) : (
						<div
							key={item.key}
							className="flex gap-2 px-2 py-2 font-heading text-[14px]"
						>
							<StickyNote
								aria-hidden
								className="mt-0.5 size-3.5 shrink-0 text-subtle"
							/>
							{item.note.text ?? "Resaltado sin texto"}
						</div>
					),
				)}
			</PopoverContent>
		</Popover>
	);
}
