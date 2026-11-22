import { ChevronRight, FileText } from "lucide-react";
import {
	type KeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#components/ui/collapsible.tsx";
import { cn } from "#lib/utils.ts";
import type { Block, Turn } from "../../shared/protocol.ts";
import { Markdown } from "../markdown/Markdown.tsx";
import { toolLabel, visibleBlocks } from "./model.ts";

/** Everything a thread variant gets from the app. */
export type ThreadActions = {
	send: (text: string) => void;
	stop: () => void;
	/** Drops a failed outgoing message and returns its text. */
	discard: (clientMsgId: string) => string;
};

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
								className="answer"
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
	return (
		<div
			className={cn(
				"inline-flex w-fit max-w-full items-center gap-1.5 text-[13px] text-subtle",
				failed && "text-destructive",
			)}
			title={block.result?.summary}
		>
			<FileText aria-hidden className="size-3.5 shrink-0" />
			<span className={cn("truncate", !block.result && "thinking-shimmer")}>
				{toolLabel(block)}
				{failed ? " (falló)" : ""}
			</span>
		</div>
	);
}

// ── Composer logic ───────────────────────────────────────────────────────────

const coarse = () =>
	typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/**
 * Composer state and keys: Enter sends (a newline on touch screens), Shift+Enter
 * is a newline, Esc stops a running answer. Sending while Claude answers
 * queues the message.
 */
export function useComposer({
	running,
	actions,
}: {
	running: boolean;
	actions: ThreadActions;
}) {
	const [text, setText] = useState("");
	const ref = useRef<HTMLTextAreaElement>(null);
	const canSend = text.trim().length > 0;
	const submit = useCallback(() => {
		if (!text.trim()) return;
		actions.send(text.trim());
		setText("");
		ref.current?.focus();
	}, [text, actions]);
	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.nativeEvent.isComposing) return;
		if (e.key === "Enter" && !e.shiftKey && !coarse()) {
			e.preventDefault();
			submit();
		} else if (e.key === "Escape" && running) {
			e.preventDefault();
			actions.stop();
		}
	};
	const restore = (value: string) => {
		setText(value);
		ref.current?.focus();
	};
	return { text, setText, ref, canSend, submit, onKeyDown, restore };
}

/** Esc anywhere on the page stops a running answer. */
export function useStopOnEscape(running: boolean, stop: () => void) {
	useEffect(() => {
		if (!running) return;
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key === "Escape" && !e.defaultPrevented) stop();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [running, stop]);
}

// ── Scrolling ────────────────────────────────────────────────────────────────

/**
 * Keeps a scroll container pinned to the bottom while content grows, as long
 * as the reader is already there. Scrolling up releases it.
 */
export function useStickToBottom(
	scroller: RefObject<HTMLElement | null>,
	content: RefObject<HTMLElement | null>,
) {
	const [atBottom, setAtBottom] = useState(true);
	const pinned = useRef(true);

	useLayoutEffect(() => {
		const el = scroller.current;
		const inner = content.current;
		if (!el || !inner) return;
		el.scrollTop = el.scrollHeight;
		const onScroll = () => {
			const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
			pinned.current = near;
			setAtBottom(near);
		};
		const observer = new ResizeObserver(() => {
			if (pinned.current) el.scrollTop = el.scrollHeight;
		});
		observer.observe(inner);
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			observer.disconnect();
			el.removeEventListener("scroll", onScroll);
		};
	}, [scroller, content]);

	const scrollToBottom = useCallback(() => {
		const el = scroller.current;
		if (!el) return;
		pinned.current = true;
		el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
	}, [scroller]);

	return { atBottom, scrollToBottom, pin: () => (pinned.current = true) };
}
