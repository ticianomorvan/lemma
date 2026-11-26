/**
 * "Leer · Practicar": the session's two views, switched instantly (no
 * animation) from the header or with ⌥1 / ⌥2 (Alt+1 / Alt+2 off a Mac),
 * matched by key position so ⌥ doesn't type "¡" first. Each client keeps its
 * own view.
 */
import { BookOpen, NotebookPen } from "lucide-react";
import { useEffect } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#components/ui/popover.tsx";
import { Tabs, TabsList, TabsTrigger } from "#components/ui/tabs.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#components/ui/tooltip.tsx";
import { cn } from "#lib/utils.ts";
import type { Layout } from "./layout.ts";

export type View = "read" | "practice";

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);

/** ⌥1 / ⌥2 anywhere on the page. */
export function useViewKeys(onView: (view: View) => void) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!e.altKey || e.metaKey || e.ctrlKey) return;
			if (e.code === "Digit1") onView("read");
			else if (e.code === "Digit2") onView("practice");
			else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onView]);
}

export function ViewSwitch({
	view,
	onView,
	layout,
	noPdfsIn,
}: {
	view?: View;
	onView: (view: View) => void;
	layout: Layout;
	/** The course, when it has no PDFs: Read is off, and its tip says where to put them. */
	noPdfsIn?: string;
}) {
	const mod = isMac() ? "⌥" : "Alt+";
	const iconOnly = layout === "phone";
	const tab = (
		value: View,
		label: string,
		Icon: typeof BookOpen,
		key: string,
	) => {
		const off = value === "read" && noPdfsIn !== undefined;
		const trigger = (
			<TabsTrigger
				value={value}
				disabled={off}
				aria-label={iconOnly ? label : undefined}
				// Instant: the control changes state, it doesn't travel.
				className={cn(
					"h-7 gap-1.5 px-2.5 text-[13px] transition-none",
					iconOnly && "w-9 px-0",
				)}
			>
				<Icon aria-hidden className="size-4" />
				{!iconOnly && label}
			</TabsTrigger>
		);
		if (iconOnly && !off) return <span key={value}>{trigger}</span>;
		// A disabled tab takes no pointer events, so its wrapper opens the tip.
		const wrapper = (
			<span className="[&_button:disabled]:pointer-events-none" />
		);
		const why = (
			<>
				<span className="font-medium">Este curso no tiene apuntes</span>
				<span className="opacity-80">
					Copiá los PDFs del curso a {noPdfsIn}/materials/, o escribí notas de
					Typst en {noPdfsIn}/notes/, en la carpeta de estudio.
				</span>
			</>
		);
		// Touch can't hover: on a phone the tip is a tap away instead.
		if (iconOnly) {
			return (
				<Popover key={value}>
					<PopoverTrigger
						nativeButton={false}
						aria-label={`${label}: este curso no tiene apuntes`}
						render={wrapper}
					>
						{trigger}
					</PopoverTrigger>
					<PopoverContent
						align="start"
						className="w-[min(256px,calc(100vw-24px))] gap-1 text-[13px]"
					>
						{why}
					</PopoverContent>
				</Popover>
			);
		}
		return (
			<Tooltip key={value}>
				<TooltipTrigger render={wrapper}>{trigger}</TooltipTrigger>
				<TooltipContent className={cn(off && "max-w-64 flex-col items-start")}>
					{off ? (
						why
					) : (
						<>
							{label}
							<kbd className="rounded bg-background/15 px-1 font-sans">
								{mod}
								{key}
							</kbd>
						</>
					)}
				</TooltipContent>
			</Tooltip>
		);
	};
	return (
		<Tabs value={view ?? null} onValueChange={(v) => onView(v as View)}>
			<TabsList aria-label="Vista" className="h-8">
				{tab("read", "Leer", BookOpen, "1")}
				{tab("practice", "Practicar", NotebookPen, "2")}
			</TabsList>
		</Tabs>
	);
}
