import type {
	Block,
	SessionView,
	Turn,
	UserMessage,
} from "../../shared/protocol.ts";
import type { Outgoing, SessionState } from "../store.ts";

/** One row of the thread, oldest first, in the order a reader sees them. */
export type ThreadItem =
	| { kind: "turn"; turn: Turn; state: TurnState; error?: string }
	| { kind: "queued"; user: UserMessage; position: number }
	| { kind: "outgoing"; message: Outgoing };

export type TurnState = "streaming" | "completed" | "interrupted" | "error";

export function threadItems({ view, outgoing }: SessionState): ThreadItem[] {
	const items: ThreadItem[] = [];
	if (view) {
		view.turns.forEach((turn, i) => {
			const last = i === view.turns.length - 1 && !view.inflight;
			const state = turn.end?.reason ?? "completed";
			items.push({
				kind: "turn",
				turn,
				state,
				...(state === "error"
					? { error: last && view.error ? view.error.message : "" }
					: {}),
			});
		});
		if (view.inflight) {
			items.push({ kind: "turn", turn: view.inflight, state: "streaming" });
		}
		view.queue.forEach((user, i) => {
			items.push({ kind: "queued", user, position: i + 1 });
		});
	}
	for (const message of outgoing) items.push({ kind: "outgoing", message });
	return items;
}

/** The DOM id of a turn's cell, for the index to scroll to. */
export const cellId = (turnId: string) => `turn-${turnId}`;

export const isRunning = (view?: SessionView) => view?.status === "running";

/** Visible blocks: thinking with no summary text is dropped. */
export function visibleBlocks(turn: Turn): Block[] {
	return turn.blocks.filter(
		(b) => b.kind !== "thinking" || b.text.trim() || !b.done,
	);
}

/** "Leyó notas.md" from a tool block's partial JSON input. */
export function toolLabel(block: Block): string {
	const input = parseLoose(block.text);
	const target =
		(typeof input.file_path === "string" && basename(input.file_path)) ||
		(typeof input.pattern === "string" && input.pattern) ||
		"";
	const verb =
		block.name === "Read"
			? "Leyendo"
			: block.name === "Grep"
				? "Buscando"
				: block.name === "Glob"
					? "Listando"
					: (block.name ?? "Herramienta");
	const past =
		block.name === "Read"
			? "Leyó"
			: block.name === "Grep"
				? "Buscó"
				: block.name === "Glob"
					? "Listó"
					: (block.name ?? "Herramienta");
	return `${block.result ? past : verb}${target ? ` ${target}` : ""}`;
}

function parseLoose(json: string): Record<string, unknown> {
	try {
		return JSON.parse(json) as Record<string, unknown>;
	} catch {
		const m = /"(file_path|pattern)"\s*:\s*"([^"]*)/.exec(json);
		return m?.[1] && m[2] !== undefined ? { [m[1]]: m[2] } : {};
	}
}

const basename = (path: string) => path.split("/").pop() ?? path;
