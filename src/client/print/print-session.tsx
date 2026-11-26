/**
 * A session as a printed document: its title, course and date, every turn
 * (question, photos and answer text; no thinking, tools or controls), then
 * its notes. It is mounted only while printing, from either view, and draws
 * in the light scheme whatever the page's (print.css).
 */
import "./print.css";
import type { Ref } from "react";
import type { SessionView, Turn } from "../../shared/protocol.ts";
import { SchemeOverride } from "../blocks/theme.ts";
import { Markdown } from "../markdown/lazy.tsx";
import { TurnBlocks } from "../thread/parts.tsx";
import { Citation, Question } from "../thread/thread.tsx";

export function PrintSession({
	view,
	ref,
}: {
	view: SessionView;
	ref: Ref<HTMLDivElement>;
}) {
	const { meta } = view;
	const turns = view.inflight ? [...view.turns, view.inflight] : view.turns;
	const notes = view.notes.toSorted(
		(a, b) =>
			a.anchor.path.localeCompare(b.anchor.path) ||
			a.anchor.page - b.anchor.page,
	);
	return (
		<SchemeOverride value="light">
			<div ref={ref} className="print-root theme-light" aria-hidden>
				<header className="print-head">
					<h1>{meta.title || "Sin título"}</h1>
					<p>
						{meta.course} ·{" "}
						<time dateTime={meta.created}>{longDate(meta.created)}</time>
					</p>
				</header>
				{turns.map((turn) => (
					<section key={turn.id} className="print-turn">
						<Question
							text={turn.user.text}
							photos={turn.user.attachments}
							anchor={turn.user.anchor}
							label={turn === view.inflight ? "Sin terminar" : ""}
							tone="muted"
							eager
						/>
						<div className="print-answer">
							<TurnBlocks turn={textOnly(turn)} streaming={false} />
						</div>
					</section>
				))}
				{notes.length > 0 && (
					<section className="print-notes">
						<h2>Notas</h2>
						{notes.map((note) => (
							<div key={note.id} className="print-note">
								<Citation anchor={note.anchor} />
								{note.text && (
									<div className="answer">
										<Markdown text={note.text} />
									</div>
								)}
							</div>
						))}
					</section>
				)}
			</div>
		</SchemeOverride>
	);
}

/** A turn's answer text only: thinking and tool rows are for the screen. */
const textOnly = (turn: Turn): Turn => ({
	...turn,
	blocks: turn.blocks.filter((b) => b.kind === "text"),
});

const longDate = (iso: string) =>
	new Date(iso).toLocaleDateString("es", {
		day: "numeric",
		month: "long",
		year: "numeric",
	});
