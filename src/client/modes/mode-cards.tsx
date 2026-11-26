/**
 * An empty session's study modes as cards, a way to start with one. Tapping
 * the chosen card again clears it.
 */
import { cn } from "#lib/utils.ts";
import type { SessionMeta } from "../../shared/protocol.ts";
import { iconOf, press } from "./icons.ts";
import { useModes, useSessionMode } from "./use-modes.ts";

export function ModeCards({ meta }: { meta?: SessionMeta }) {
	const modes = useModes();
	const { mode, choose } = useSessionMode(meta);
	if (modes.length === 0) return null;
	return (
		<fieldset className="mx-auto mt-8 grid w-full max-w-[560px] grid-cols-2 gap-2 text-left">
			<legend className="mb-2 w-full text-center text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">
				Elegí un modo, si querés
			</legend>
			{modes.map((m) => {
				const on = m.id === mode;
				const Icon = iconOf(m.id);
				return (
					<button
						key={m.id}
						type="button"
						aria-pressed={on}
						onClick={() => choose(on ? null : m.id)}
						className={cn(
							"grid content-start gap-1 rounded-xl border bg-card p-3 text-left shadow-sm",
							press,
							on ? "border-primary/40 bg-primary-soft" : "hover:border-input",
						)}
					>
						<span
							className={cn(
								"flex items-center gap-1.5 text-[14px] font-medium",
								on && "text-primary",
							)}
						>
							<Icon aria-hidden className="size-4" />
							{m.label}
						</span>
						{m.description && (
							<span className="text-[12px] leading-snug text-muted-foreground text-pretty max-sm:hidden">
								{m.description}
							</span>
						)}
					</button>
				);
			})}
		</fieldset>
	);
}
