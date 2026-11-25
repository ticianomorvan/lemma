/**
 * Practice's drawer: a citation's PDF page, from the right on a tablet or
 * desktop and from the bottom on a phone, scrolled to the quoted passage
 * and with it highlighted. Its own chunk, with pdf.js after it: it loads
 * when a citation is first opened.
 */
import { BookOpen, FileText, X } from "lucide-react";
import {
	lazy,
	Suspense,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "#components/ui/sheet.tsx";
import { cn } from "#lib/utils.ts";
import type { Anchor, SessionView } from "../../shared/protocol.ts";
import {
	anchorRange,
	layers,
	type PagePlace,
	passageKey,
	revealAnchor,
	SCROLLER,
} from "../read/anchors.ts";
import { groups, marginItems, marksOf } from "../read/items.ts";
import { basename } from "../thread/model.ts";

const PdfPages = lazy(() => import("../read/pdf-pages.tsx"));

export default function CitationDrawer({
	anchor,
	view,
	phone,
	onClose,
	onPlace,
	canRead,
	onRead,
}: {
	anchor?: Anchor;
	view?: SessionView;
	phone: boolean;
	onClose: () => void;
	onPlace: (place: PagePlace) => void;
	canRead: (path: string) => boolean;
	onRead: () => void;
}) {
	// The page stays while the drawer slides away.
	const [shown, setShown] = useState(anchor);
	if (anchor && anchor !== shown) setShown(anchor);

	return (
		<Sheet open={!!anchor} onOpenChange={(open) => !open && onClose()}>
			<SheetContent
				side={phone ? "bottom" : "right"}
				showCloseButton={false}
				className={cn(
					"gap-0 overflow-hidden bg-background duration-300 ease-(--ease-drawer)",
					phone
						? "data-[side=bottom]:h-[92dvh] rounded-t-2xl"
						: "data-[side=right]:w-[min(640px,92vw)] data-[side=right]:sm:max-w-none",
				)}
			>
				{shown && (
					<CitedPage
						// A new citation opens fresh at its own page.
						key={`${passageKey(shown)}`}
						anchor={shown}
						view={view}
						phone={phone}
						onPlace={onPlace}
						onRead={canRead(shown.path) ? onRead : undefined}
					/>
				)}
			</SheetContent>
		</Sheet>
	);
}

function CitedPage({
	anchor,
	view,
	phone,
	onPlace,
	onRead,
}: {
	anchor: Anchor;
	view?: SessionView;
	phone: boolean;
	onPlace: (place: PagePlace) => void;
	onRead?: () => void;
}) {
	const [pages, setPages] = useState(0);
	const [page, setPage] = useState(anchor.page);
	const [placed, setPlaced] = useState(false);
	const active = passageKey(anchor);
	// Every passage of this file is painted, as in Read; the cited one stronger.
	const marks = useMemo(
		() => marksOf(groups(marginItems(view, anchor.path))),
		[view, anchor.path],
	);
	const start = useMemo(() => ({ page: anchor.page, into: 0 }), [anchor.page]);

	// Once the drawer is at the page and its text layer is drawn, centre the
	// passage (a jump: the drawer has only just opened) and flash it.
	const drawn = useSyncExternalStore(layers.subscribe, layers.version);
	const revealed = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `drawn` retries as layers draw
	useEffect(() => {
		if (!placed || revealed.current || !anchorRange(anchor)) return;
		revealed.current = true;
		revealAnchor(anchor, { instant: true });
	}, [placed, drawn, anchor]);

	return (
		<>
			{phone && (
				<div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-input" />
			)}
			<div className="flex h-12 shrink-0 items-center gap-2 border-b bg-card pr-2 pl-4">
				<FileText aria-hidden className="size-4 shrink-0 text-subtle" />
				<SheetTitle className="min-w-0 truncate font-sans text-[13.5px] tabular-nums">
					{basename(anchor.path)} · p. {page}
					{pages ? ` de ${pages}` : ""}
				</SheetTitle>
				<SheetDescription className="sr-only">
					La página que cita la pregunta, con el pasaje resaltado
				</SheetDescription>
				<span className="flex-1" />
				{onRead && (
					<button
						type="button"
						onClick={onRead}
						className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-muted-foreground transition-[color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.97]"
					>
						<BookOpen aria-hidden className="size-3.5" />
						Abrir en Leer
					</button>
				)}
				<SheetClose
					aria-label="Cerrar"
					className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-[color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.97]"
				>
					<X aria-hidden className="size-4" />
				</SheetClose>
			</div>
			<div
				{...SCROLLER}
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5"
			>
				<Suspense fallback={null}>
					<PdfPages
						path={anchor.path}
						marks={marks}
						active={active}
						place={start}
						onPlace={(now) => {
							setPlaced(true);
							onPlace(now);
						}}
						onPages={setPages}
						onPage={setPage}
						compact={phone}
					/>
				</Suspense>
			</div>
		</>
	);
}
