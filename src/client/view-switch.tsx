/**
 * "Leer · Practicar": the session's two views, switched instantly (no
 * animation) from the header or with ⌥1 / ⌥2 (Alt+1 / Alt+2 off a Mac),
 * matched by key position so ⌥ doesn't type "¡" first. Each client keeps its
 * own view.
 */
import { BookOpen, NotebookPen } from "lucide-react";
import { useEffect } from "react";
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
	noReading,
}: {
	view?: View;
	onView: (view: View) => void;
	layout: Layout;
	/** Set when the course has no PDFs: Read is off, and this says where to put them. */
	noReading?: string;
}) {
	const mod = isMac() ? "⌥" : "Alt+";
	const iconOnly = layout === "phone";
	const tab = (
		value: View,
		label: string,
		Icon: typeof BookOpen,
		key: string,
	) => {
		const off = value === "read" && noReading !== undefined;
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
		return iconOnly && !off ? (
			<span key={value}>{trigger}</span>
		) : (
			<Tooltip key={value}>
				{/* A disabled tab takes no pointer events, so its wrapper shows the tip. */}
				<TooltipTrigger
					render={<span className="[&_button:disabled]:pointer-events-none" />}
				>
					{trigger}
				</TooltipTrigger>
				<TooltipContent className={cn(off && "max-w-64 flex-col items-start")}>
					{off ? (
						<>
							<span className="font-medium">Este curso no tiene apuntes</span>
							<span className="opacity-80">{noReading}</span>
						</>
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
