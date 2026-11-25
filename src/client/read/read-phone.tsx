/**
 * Read on a phone (below 640 px): no margin. A strip along the bottom holds
 * the visible page's cards, the chat opens as a bottom sheet, and a note is
 * written in its own sheet.
 */
import { MessagesSquare } from "lucide-react";
import { type ReactNode, type RefObject, useState } from "react";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "#components/ui/sheet.tsx";
import { cn } from "#lib/utils.ts";
import { snippet } from "../thread/model.ts";
import { SCROLLER } from "./anchors.ts";
import type { Group } from "./items.ts";
import type { Draft } from "./margin.tsx";

/** The strip card a passage scrolls to. */
export const stripId = (key: string) => `strip-${encodeURIComponent(key)}`;

export function PhoneRead({
	scroller,
	pdf,
	fileMenu,
	page,
	groups,
	chat,
	setChat,
	panel,
	turnCount,
	openTurn,
	draft,
	onDraftDone,
	selection,
	status,
}: {
	scroller: RefObject<HTMLDivElement | null>;
	pdf: ReactNode;
	fileMenu: ReactNode;
	page: number;
	groups: Group[];
	chat: boolean;
	setChat: (open: boolean) => void;
	panel: (closeIcon?: "panel" | "x") => ReactNode;
	turnCount: number;
	openTurn: (turnId: string) => void;
	draft?: Draft;
	onDraftDone: (text: string | null) => void;
	selection: ReactNode;
	status: ReactNode;
}) {
	const onPage = groups.filter((g) => g.anchor.page === page);

	return (
		<div className="h-full min-h-0">
			<div className="relative h-full min-h-0">
				<div
					ref={scroller}
					{...SCROLLER}
					className="h-full overflow-y-auto overscroll-contain px-2 pt-2 pb-40"
				>
					<div className="sticky top-0 z-10 mb-2 flex justify-center">
						{fileMenu}
					</div>
					{pdf}
				</div>
				{selection}
				{status}
				<Strip
					groups={onPage}
					page={page}
					openTurn={openTurn}
					onChat={() => setChat(true)}
					turnCount={turnCount}
				/>
			</div>

			<Sheet open={chat} onOpenChange={setChat}>
				<SheetContent
					side="bottom"
					showCloseButton={false}
					className="data-[side=bottom]:h-[92dvh] gap-0 overflow-hidden rounded-t-2xl duration-300 ease-(--ease-drawer)"
				>
					<SheetTitle className="sr-only">Chat</SheetTitle>
					<SheetDescription className="sr-only">
						El hilo de la sesión
					</SheetDescription>
					<div className="mx-auto mt-2 mb-1 h-1 w-9 shrink-0 rounded-full bg-input" />
					<div className="min-h-0 flex-1">{panel("x")}</div>
				</SheetContent>
			</Sheet>

			<Sheet open={!!draft} onOpenChange={(o) => !o && onDraftDone(null)}>
				<SheetContent
					side="bottom"
					showCloseButton={false}
					className="gap-0 rounded-t-2xl p-3 pb-[max(12px,env(safe-area-inset-bottom))] duration-300 ease-(--ease-drawer)"
				>
					<SheetTitle className="sr-only">Nueva nota</SheetTitle>
					<SheetDescription className="sr-only">
						Una nota sobre el pasaje seleccionado
					</SheetDescription>
					{draft && <PhoneNote draft={draft} onDone={onDraftDone} />}
				</SheetContent>
			</Sheet>
		</div>
	);
}

function PhoneNote({
	draft,
	onDone,
}: {
	draft: Draft;
	onDone: (text: string | null) => void;
}) {
	const [text, setText] = useState("");
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				onDone(text.trim());
			}}
			className="grid gap-2"
		>
			<p className="line-clamp-3 border-l-2 border-highlight pl-2 font-heading text-[14px] text-muted-foreground italic">
				{draft.anchor.text}
			</p>
			<textarea
				value={text}
				onChange={(e) => setText(e.target.value)}
				rows={3}
				aria-label="Nota"
				placeholder="Escribí la nota (opcional)…"
				className="w-full resize-none rounded-lg bg-secondary px-3 py-2 font-heading text-[16px] outline-none"
			/>
			<button
				type="submit"
				className="h-11 rounded-lg bg-primary text-[15px] font-medium text-primary-foreground active:scale-[0.99]"
			>
				Guardar nota
			</button>
		</form>
	);
}

/** The phone's margin: the visible page's cards in a strip along the bottom. */
function Strip({
	groups,
	page,
	openTurn,
	onChat,
	turnCount,
}: {
	groups: Group[];
	page: number;
	openTurn: (turnId: string) => void;
	onChat: () => void;
	turnCount: number;
}) {
	const [noteOpen, setNoteOpen] = useState<{ text?: string; quote: string }>();
	const count = groups.reduce((n, g) => n + g.items.length, 0);
	return (
		<div className="absolute inset-x-0 bottom-0 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
			<div className="flex items-center justify-between px-3 pt-2 text-[12px] text-subtle">
				<span>
					p. {page} ·{" "}
					{count === 0 ? "sin preguntas ni notas" : `${count} en esta página`}
				</span>
				<button
					type="button"
					onClick={onChat}
					className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 font-medium text-primary active:scale-[0.97]"
				>
					<MessagesSquare aria-hidden className="size-3.5" />
					Chat · {turnCount}
				</button>
			</div>
			<div className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-3 pt-1.5 pb-3 [scrollbar-width:none]">
				{count === 0 && (
					<p className="py-3 text-[13px] text-muted-foreground">
						Seleccioná texto para preguntar o anotar.
					</p>
				)}
				{groups.flatMap((g) =>
					g.items.map((item, i) => (
						<button
							key={item.key}
							id={i === 0 ? stripId(g.key) : undefined}
							type="button"
							onClick={() =>
								item.kind === "turn"
									? openTurn(item.key)
									: setNoteOpen({
											quote: item.anchor.text,
											...(item.note.text ? { text: item.note.text } : {}),
										})
							}
							className={cn(
								"h-[76px] w-[78%] max-w-[300px] shrink-0 snap-center rounded-xl border bg-card px-3 py-2 text-left shadow-sm active:scale-[0.99]",
								item.kind === "note" && "border-l-[3px] border-l-highlight",
							)}
						>
							<span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-subtle uppercase">
								{item.kind === "turn" ? (
									<>
										<span className="grid size-[18px] place-items-center rounded-full bg-primary text-[10.5px] text-primary-foreground">
											{item.n}
										</span>
										{item.streaming ? (
											<span className="text-primary">Respondiendo</span>
										) : (
											"Pregunta"
										)}
									</>
								) : (
									"Nota"
								)}
							</span>
							<span className="mt-1 line-clamp-2 text-[13.5px] leading-snug">
								{item.kind === "turn"
									? snippet(item.turn.user.text)
									: (item.note.text ?? snippet(item.anchor.text))}
							</span>
						</button>
					)),
				)}
			</div>
			<Sheet
				open={!!noteOpen}
				onOpenChange={(o) => !o && setNoteOpen(undefined)}
			>
				<SheetContent
					side="bottom"
					className="gap-2 rounded-t-2xl p-4 pb-[max(16px,env(safe-area-inset-bottom))] duration-300 ease-(--ease-drawer)"
				>
					<SheetTitle className="text-[13px] font-semibold tracking-[0.06em] text-subtle uppercase">
						Nota
					</SheetTitle>
					<SheetDescription className="line-clamp-4 border-l-2 border-highlight pl-2 font-heading text-[14px] italic">
						{noteOpen?.quote}
					</SheetDescription>
					<p className="font-heading text-[16px]">
						{noteOpen?.text ?? (
							<span className="text-subtle">Resaltado sin texto</span>
						)}
					</p>
				</SheetContent>
			</Sheet>
		</div>
	);
}
