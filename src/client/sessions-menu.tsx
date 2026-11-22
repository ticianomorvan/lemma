/**
 * The header's session picker: every session in the study folder, grouped by
 * course (newest first), a new session per course, and a new course. It reads
 * the folder fresh each time it opens.
 */
import { ChevronDown, Plus } from "lucide-react";
import { useState } from "react";
import { Input } from "#components/ui/input.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#components/ui/popover.tsx";
import { cn } from "#lib/utils.ts";
import type { SessionSummary, StateResponse } from "../shared/protocol.ts";

export function SessionsMenu({
	current,
	label,
	loadState,
	onOpen,
	onCreate,
}: {
	current: string | null;
	label: string;
	loadState: () => Promise<StateResponse>;
	onOpen: (id: string) => void;
	onCreate: (course: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [state, setState] = useState<StateResponse>();
	const [course, setCourse] = useState("");

	const groups = new Map<string, SessionSummary[]>(
		(state?.courses ?? []).map((c) => [c, []]),
	);
	for (const s of [...(state?.sessions ?? [])].reverse()) {
		groups.get(s.course)?.push(s);
	}

	const close = (then: () => void) => {
		setOpen(false);
		then();
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) void loadState().then(setState, () => {});
			}}
		>
			<PopoverTrigger
				title={label}
				className="inline-flex h-8 min-w-0 max-w-[min(100%,480px)] items-center gap-1 rounded-lg px-2 text-[13px] text-muted-foreground transition-[transform,color,background-color] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.97] aria-expanded:bg-muted aria-expanded:text-foreground"
			>
				<span className="truncate">{label}</span>
				<ChevronDown aria-hidden className="size-3.5 shrink-0" />
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="max-h-[min(70dvh,520px)] w-[min(340px,calc(100vw-24px))] gap-0 overflow-y-auto p-1.5"
			>
				{state && groups.size === 0 && (
					<p className="px-2 py-3 text-sm text-muted-foreground">
						Todavía no hay materias. Creá la primera abajo.
					</p>
				)}
				{[...groups].map(([name, sessions]) => (
					<section key={name} className="py-1">
						<div className="flex items-center gap-1 px-2 pt-1 pb-0.5">
							<h3
								title={name}
								className="flex-1 truncate text-xs font-medium tracking-wide text-muted-foreground uppercase"
							>
								{name}
							</h3>
							<button
								type="button"
								aria-label={`Nueva sesión en ${name}`}
								onClick={() => close(() => onCreate(name))}
								className="grid size-6 place-items-center rounded-md text-muted-foreground transition-[transform,color,background-color] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.94]"
							>
								<Plus aria-hidden className="size-3.5" />
							</button>
						</div>
						{sessions.length === 0 && (
							<p className="px-2 py-1 text-[13px] text-muted-foreground">
								Sin sesiones
							</p>
						)}
						{sessions.map((s) => (
							<button
								key={s.id}
								type="button"
								aria-current={s.id === current ? "page" : undefined}
								title={s.title || undefined}
								// The open session starts in view, however long the list.
								ref={
									s.id === current
										? (el) => el?.scrollIntoView({ block: "nearest" })
										: undefined
								}
								onClick={() => close(() => onOpen(s.id))}
								className={cn(
									"flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150 hover:bg-muted",
									s.id === current &&
										"bg-primary-soft text-primary hover:bg-primary-soft",
								)}
							>
								<span className="min-w-0 flex-1 truncate">
									{s.title || "Sin título"}
								</span>
								<time
									dateTime={s.updated}
									className="shrink-0 text-xs text-muted-foreground tabular-nums"
								>
									{shortDate(s.updated)}
								</time>
							</button>
						))}
					</section>
				))}
				<form
					className="mt-1 flex gap-1.5 border-t p-1.5 pt-2.5"
					onSubmit={(e) => {
						e.preventDefault();
						const name = course.trim();
						if (name) close(() => onCreate(name));
						setCourse("");
					}}
				>
					<Input
						value={course}
						onChange={(e) => setCourse(e.target.value)}
						placeholder="Nueva materia"
						aria-label="Nueva materia"
						className="h-8"
					/>
					<button
						type="submit"
						disabled={!course.trim()}
						className="h-8 shrink-0 rounded-lg border bg-card px-2.5 text-[13px] transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-50"
					>
						Crear
					</button>
				</form>
			</PopoverContent>
		</Popover>
	);
}

const shortDate = (iso: string) =>
	new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short" });
