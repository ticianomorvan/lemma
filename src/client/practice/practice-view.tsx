/**
 * Practice: the session's thread as a notebook (docs/architecture.md →
 * Views). An anchored question's citation opens its PDF page in a drawer,
 * from the right on a tablet or desktop and from the bottom on a phone,
 * scrolled to the quoted passage and with it highlighted.
 *
 * Notes have no place in the thread's order, so the notebook doesn't list
 * them; the drawer paints them on the page (underlined), as Read does.
 */
import { lazy, Suspense, useState } from "react";
import type { Anchor } from "../../shared/protocol.ts";
import type { Layout } from "../layout.ts";
import type { PagePlace } from "../read/anchors.ts";
import type { SessionState } from "../store.ts";
import type { ComposerDraft, ThreadPlace } from "../thread/hooks.ts";
import type { ThreadActions } from "../thread/model.ts";
import { Thread } from "../thread/thread.tsx";

/** The drawer, and pdf.js after it, load when a citation is first opened. */
const CitationDrawer = lazy(() => import("./citation-drawer.tsx"));

export function PracticeView({
	state,
	actions,
	layout,
	draft,
	place,
	cited,
	onCite,
	onDrawerPlace,
	canRead,
	onRead,
}: {
	state: SessionState;
	actions: ThreadActions;
	layout: Layout;
	/** The composer's text, shared with Read. */
	draft: ComposerDraft;
	/** The notebook's scroll, kept across switches. */
	place: { current?: ThreadPlace };
	/** The citation whose page the drawer shows, if it is open. */
	cited?: Anchor;
	onCite: (anchor: Anchor | undefined) => void;
	/** Where the drawer's pages are scrolled, as the reader moves. */
	onDrawerPlace: (place: PagePlace) => void;
	/** Whether Read can open a file (it is in the course's materials). */
	canRead: (path: string) => boolean;
	/** Opens Read on the drawer's page. */
	onRead: () => void;
}) {
	const [opened, setOpened] = useState(false);
	if (cited && !opened) setOpened(true);
	return (
		<>
			<Thread
				state={state}
				actions={actions}
				onCite={onCite}
				draft={draft}
				place={place}
			/>
			{opened && (
				<Suspense fallback={null}>
					<CitationDrawer
						anchor={cited}
						view={state.view}
						phone={layout === "phone"}
						onClose={() => onCite(undefined)}
						onPlace={onDrawerPlace}
						canRead={canRead}
						onRead={onRead}
					/>
				</Suspense>
			)}
		</>
	);
}
