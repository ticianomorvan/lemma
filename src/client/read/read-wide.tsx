/**
 * Read on a tablet or desktop: the page with margin cards beside it, or,
 * with the chat open, bars in the left gutter and the panel. On a desktop
 * the panel covers the margin; a tablet has no room to cover the page, so
 * there it pushes the page aside.
 */
import type { ReactNode, RefObject } from "react";
import { cn } from "#lib/utils.ts";
import { SCROLLER } from "./anchors.ts";
import { ChatButton } from "./chat-panel.tsx";
import type { Group } from "./items.ts";
import { type Draft, Gutter, Margin } from "./margin.tsx";

export function WideRead({
	desktop,
	scroller,
	pdf,
	fileMenu,
	groups,
	chat,
	setChat,
	panel,
	turnCount,
	openTurn,
	active,
	onActive,
	draft,
	onDraftDone,
	selection,
	status,
}: {
	desktop: boolean;
	scroller: RefObject<HTMLDivElement | null>;
	pdf: ReactNode;
	fileMenu: ReactNode;
	groups: Group[];
	chat: boolean;
	setChat: (open: boolean) => void;
	panel: (closeIcon?: "panel" | "x") => ReactNode;
	turnCount: number;
	openTurn: (turnId: string) => void;
	active?: string;
	onActive: (key: string | undefined) => void;
	draft?: Draft;
	onDraftDone: (text: string | null) => void;
	selection: ReactNode;
	status: ReactNode;
}) {
	const push = chat && !desktop;
	const overlay = chat && desktop;

	return (
		<div
			className="relative grid h-full min-h-0"
			style={{
				gridTemplateColumns: push ? "minmax(0,1fr) 360px" : "minmax(0,1fr)",
			}}
		>
			<div
				ref={scroller}
				{...SCROLLER}
				className="min-h-0 overflow-y-auto overscroll-contain"
			>
				<div
					className={cn(
						"mx-auto flex max-w-full items-start justify-center",
						desktop ? "gap-4 px-8 pt-14" : "gap-3 px-4 pt-14",
					)}
				>
					{/* The bars' column stays while the chat is closed, so opening it doesn't move the page. */}
					<Gutter
						groups={chat ? groups : []}
						onOpenTurn={openTurn}
						onActive={onActive}
					/>
					<div className="min-w-0 flex-[0_1_760px] pb-24">{pdf}</div>
					{!chat && (
						<div
							className={cn("shrink-0", desktop ? "w-[340px]" : "w-[248px]")}
						>
							<Margin
								groups={groups}
								active={active}
								onActive={onActive}
								onOpenTurn={openTurn}
								draft={draft}
								onDraftDone={onDraftDone}
							/>
						</div>
					)}
					{overlay && (
						// Keeps the margin's room, so the page doesn't move under the overlay.
						<div aria-hidden className="w-[340px] shrink-0" />
					)}
				</div>
			</div>
			{push && <div className="min-h-0 border-l">{panel()}</div>}
			{overlay && (
				<div className="panel-in absolute inset-y-0 right-0 z-20 w-[min(440px,100%)] border-l shadow-lg">
					{panel("x")}
				</div>
			)}
			{selection}
			<div className="absolute top-3 left-4 z-10">{fileMenu}</div>
			{!chat && (
				<ChatButton
					open={chat}
					onClick={() => setChat(true)}
					count={turnCount}
					className="absolute top-3 right-4 z-10 shadow-sm"
				/>
			)}
			{status}
		</div>
	);
}
