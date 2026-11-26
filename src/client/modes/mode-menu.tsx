/**
 * The header's study-mode button: it shows the session's mode and opens a
 * menu to pick one or clear it. Every client sees a change through the
 * `meta` event. Loaded lazily (Base UI's Menu is the bulk of it), like the
 * modes list it waits for.
 */
import { ChevronDown, type LucideIcon, Sparkles, X } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#components/ui/dropdown-menu.tsx";
import { cn } from "#lib/utils.ts";
import type { SessionMeta } from "../../shared/protocol.ts";
import { iconOf, press } from "./icons.ts";
import { refreshModes, useModes, useSessionMode } from "./use-modes.ts";

/** "No mode" in the menu's radio group (a mode id is never empty). */
const NONE = "";

/** The header's mode button and its menu, the same in Read and Practice. */
export default function ModeMenu({
	meta,
	compact,
}: {
	meta?: SessionMeta;
	/**
	 * A phone: icon only, so the session's name keeps its room. Each mode has
	 * its own icon, tinted while it is on; the menu names it.
	 */
	compact: boolean;
}) {
	const modes = useModes();
	const { mode, choose } = useSessionMode(meta);
	if (modes.length === 0 || !meta) return null;
	const current = modes.find((m) => m.id === mode);
	const Icon = current ? iconOf(current.id) : Sparkles;
	const item = (
		value: string,
		label: string,
		description: string | undefined,
		ItemIcon: LucideIcon,
	) => (
		<DropdownMenuRadioItem
			key={value}
			value={value}
			closeOnClick
			className="items-start gap-2.5 py-2 pr-8 pl-2 data-checked:bg-primary-soft data-checked:text-primary"
		>
			<ItemIcon
				aria-hidden
				className="mt-0.5 size-4 text-subtle in-data-checked:text-primary"
			/>
			<span className="min-w-0">
				<span className="block font-medium">{label}</span>
				{description && (
					<span className="block text-[12px] leading-snug text-muted-foreground text-pretty">
						{description}
					</span>
				)}
			</span>
		</DropdownMenuRadioItem>
	);
	return (
		<DropdownMenu
			onOpenChange={(open) => {
				// A mode the student just added to .claude/skills/ shows up.
				if (open) void refreshModes();
			}}
		>
			<DropdownMenuTrigger
				aria-label={`Modo de estudio: ${current?.label ?? "ninguno"}`}
				className={cn(
					"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
					press,
					current
						? "border-primary/30 bg-primary-soft text-primary"
						: "bg-card text-muted-foreground hover:border-input hover:text-foreground data-popup-open:border-input data-popup-open:text-foreground",
					compact && "px-2",
				)}
			>
				<Icon aria-hidden className="size-3.5" />
				{!compact && (
					<span className="max-w-24 truncate">{current?.label ?? "Modo"}</span>
				)}
				<ChevronDown aria-hidden className="size-3.5 opacity-60" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="w-[min(300px,calc(100vw-24px))] p-1.5"
			>
				<DropdownMenuGroup>
					<DropdownMenuLabel className="px-2 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">
						Modo de estudio
					</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						value={mode ?? NONE}
						onValueChange={(value) => choose(value === NONE ? null : value)}
					>
						{modes.map((m) => item(m.id, m.label, m.description, iconOf(m.id)))}
						<DropdownMenuSeparator />
						{item(NONE, "Sin modo", "Claude responde como siempre.", X)}
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
