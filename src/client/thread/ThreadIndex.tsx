/**
 * The thread's index: one entry per question, to jump between them. On wide
 * screens it sits in the margin beside the notebook as a column of ticks
 * that open into the questions on hover; on narrow ones it is a button that
 * opens the same list in a popover.
 */
import { ListOrdered } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#components/ui/popover.tsx";
import { cn } from "#lib/utils.ts";
import { cellId, snippet, type ThreadItem } from "./model.ts";

type TurnItem = Extract<ThreadItem, { kind: "turn" }>;

/** The id of the cell the reader is in: the last one whose top has passed a third of the view. */
export function useActiveCell(
	scroller: RefObject<HTMLElement | null>,
	ids: string[],
) {
	const [active, setActive] = useState<string>();
	const key = ids.join(" ");
	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		let frame = 0;
		const measure = () => {
			frame = 0;
			const line = el.getBoundingClientRect().top + el.clientHeight / 3;
			let current = key ? key.split(" ")[0] : undefined;
			for (const id of key.split(" ")) {
				const cell = document.getElementById(id);
				if (cell && cell.getBoundingClientRect().top <= line) current = id;
			}
			// At the very bottom the last question is the current one, however short.
			if (el.scrollHeight - el.scrollTop - el.clientHeight < 4) {
				current = key.split(" ").at(-1);
			}
			setActive(current);
		};
		const onScroll = () => {
			frame ||= requestAnimationFrame(measure);
		};
		measure();
		el.addEventListener("scroll", onScroll, { passive: true });
		// Cells move when the answer grows or the window resizes.
		const observer = new ResizeObserver(onScroll);
		observer.observe(el);
		if (el.firstElementChild) observer.observe(el.firstElementChild);
		return () => {
			el.removeEventListener("scroll", onScroll);
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [scroller, key]);
	return active;
}

function jump(scroller: RefObject<HTMLElement | null>, id: string) {
	const cell = document.getElementById(id);
	const el = scroller.current;
	if (!cell || !el) return;
	const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
	el.scrollTo({
		top:
			el.scrollTop +
			cell.getBoundingClientRect().top -
			el.getBoundingClientRect().top -
			16,
		behavior: reduce ? "auto" : "smooth",
	});
	cell.focus({ preventScroll: true });
}

export function IndexRail({
	turns,
	active,
	scroller,
}: {
	turns: TurnItem[];
	active?: string;
	scroller: RefObject<HTMLElement | null>;
}) {
	const [open, setOpen] = useState(false);
	if (turns.length < 2) return null;
	const entries = turns.map((t, i) => ({
		id: cellId(t.turn.id),
		n: i + 1,
		text: snippet(t.turn.user.text),
		state: t.state,
	}));

	// A zero-height sticky layer inside the scroller: the index stays in view,
	// and the wheel over it still scrolls the thread.
	return (
		<div className="pointer-events-none sticky top-0 z-10 h-0">
			{/* Wide screens: ticks in the right margin that open on hover or focus. */}
			<nav
				aria-label="Índice de preguntas"
				className="group/index pointer-events-auto absolute top-6 right-3 hidden max-h-[calc(100dvh-14rem)] w-56 overflow-x-hidden overflow-y-auto min-[1200px]:block"
			>
				<ol className="grid grid-cols-1 gap-0.5">
					{entries.map((e) => {
						const current = e.id === active;
						return (
							<li key={e.id} className="w-full">
								<button
									type="button"
									onClick={() => jump(scroller, e.id)}
									aria-current={current ? "true" : undefined}
									className="flex h-7 w-full items-center justify-end gap-2 rounded-md pr-1 pl-2 text-left text-[12.5px] text-subtle outline-ring focus-visible:outline-2"
								>
									<span
										className={cn(
											"min-w-0 flex-1 truncate opacity-0 transition-opacity duration-150 ease-out group-hover/index:opacity-100 group-focus-within/index:opacity-100",
											current && "text-foreground",
											"hover:text-foreground",
										)}
									>
										{e.text}
									</span>
									<span
										aria-hidden
										className={cn(
											"h-0.5 shrink-0 rounded-full transition-[width,background-color] duration-200 ease-out",
											current ? "w-5 bg-foreground" : "w-3 bg-subtle/60",
											e.state === "streaming" && "bg-primary",
											e.state === "error" && "bg-destructive",
										)}
									/>
								</button>
							</li>
						);
					})}
				</ol>
			</nav>

			{/* Narrow screens: a button that opens the list. */}
			<div className="pointer-events-auto absolute top-3 right-3 min-[1200px]:hidden">
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger
						aria-label="Índice de preguntas"
						className="grid size-8 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm transition-transform duration-150 ease-out active:scale-[0.97] data-[popup-open]:text-foreground"
					>
						<ListOrdered aria-hidden className="size-4" />
					</PopoverTrigger>
					<PopoverContent
						align="end"
						className="max-h-[60dvh] w-[min(20rem,calc(100vw-1.5rem))] gap-0 overflow-y-auto p-1"
					>
						<ol>
							{entries.map((e) => (
								<li key={e.id}>
									<button
										type="button"
										onClick={() => {
											setOpen(false);
											jump(scroller, e.id);
										}}
										aria-current={e.id === active ? "true" : undefined}
										className="flex w-full items-baseline gap-2 rounded-md px-2 py-2 text-left text-[13.5px] text-muted-foreground aria-[current=true]:bg-secondary aria-[current=true]:text-foreground"
									>
										<span className="w-5 shrink-0 text-right text-xs text-subtle tabular-nums">
											{e.n}
										</span>
										<span className="line-clamp-2 min-w-0">{e.text}</span>
									</button>
								</li>
							))}
						</ol>
					</PopoverContent>
				</Popover>
			</div>
		</div>
	);
}
