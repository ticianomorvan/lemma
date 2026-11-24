import { Calculator, ChevronRight, FileText } from "lucide-react";
import { useState } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#components/ui/collapsible.tsx";
import { cn } from "#lib/utils.ts";
import { type Block, CALC_TOOL, type Turn } from "../../shared/protocol.ts";
import { Markdown } from "../markdown/lazy.tsx";
import { toolLabel, visibleBlocks } from "./model.ts";

/** The blocks of one assistant turn: thinking, tools and answer text. */
export function TurnBlocks({
	turn,
	streaming,
}: {
	turn: Turn;
	streaming: boolean;
}) {
	const blocks = visibleBlocks(turn);
	const last = blocks.at(-1);
	return (
		<div className="grid gap-2">
			{blocks.map((block) => {
				const live = streaming && block === last && !block.done;
				switch (block.kind) {
					case "thinking":
						return <Thinking key={block.id} block={block} live={live} />;
					case "tool":
						return <ToolRow key={block.id} block={block} />;
					case "text":
						return (
							<div
								key={block.id}
								// A grid item grows to fit its widest formula unless
								// it may shrink; then `.katex-display` scrolls instead.
								className="answer min-w-0"
								data-streaming={live || undefined}
							>
								<Markdown text={block.text} />
							</div>
						);
				}
				return null;
			})}
			{streaming && (!last || last.done) && <Waiting />}
		</div>
	);
}

/** Shown while a turn has no live block yet: before the first token, or between blocks. */
function Waiting() {
	return (
		<div
			role="status"
			className="flex h-6 items-center gap-1"
			aria-label="Claude está respondiendo"
		>
			<span className="waiting-dot" />
			<span className="waiting-dot [animation-delay:120ms]" />
			<span className="waiting-dot [animation-delay:240ms]" />
		</div>
	);
}

function Thinking({ block, live }: { block: Block; live: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger className="group/think -ml-1 inline-flex h-7 items-center gap-1 rounded-md px-1 text-[13px] text-subtle transition-[color,transform] duration-150 ease-out active:scale-[0.97] hover:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
				<ChevronRight
					aria-hidden
					className="size-3.5 transition-transform duration-200 ease-out group-data-[panel-open]/think:rotate-90"
				/>
				<span className={cn(live && "thinking-shimmer")}>
					{live ? "Pensando…" : "Pensó"}
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent className="collapsible-panel">
				<p className="mt-1 border-l-2 border-border pl-3 text-[13.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
					{block.text.trim() || "…"}
				</p>
			</CollapsibleContent>
		</Collapsible>
	);
}

function ToolRow({ block }: { block: Block }) {
	const failed = block.result && !block.result.ok;
	const Icon = block.name === CALC_TOOL ? Calculator : FileText;
	return (
		<div
			className={cn(
				"inline-flex w-fit max-w-full items-center gap-1.5 text-[13px] text-subtle",
				failed && "text-destructive",
			)}
			title={block.result?.summary}
		>
			<Icon aria-hidden className="size-3.5 shrink-0" />
			<span className={cn("truncate", !block.result && "thinking-shimmer")}>
				{toolLabel(block)}
				{failed ? " (falló)" : ""}
			</span>
		</div>
	);
}
