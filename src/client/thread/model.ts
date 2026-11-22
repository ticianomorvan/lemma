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

/** What the thread can ask the app to do. */
export type ThreadActions = {
	send: (text: string) => void;
	stop: () => void;
	/** Drops a failed outgoing message and returns its text. */
	discard: (clientMsgId: string) => string;
};

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

const TOOL_VERBS: Record<string, [doing: string, done: string]> = {
	Read: ["Leyendo", "Leyó"],
	Grep: ["Buscando", "Buscó"],
	Glob: ["Listando", "Listó"],
};

/** "Leyó notas.md" from a tool block's partial JSON input. */
export function toolLabel(block: Block): string {
	const input = parseLoose(block.text);
	const target =
		(typeof input.file_path === "string" && basename(input.file_path)) ||
		(typeof input.pattern === "string" && input.pattern) ||
		"";
	const [doing, done] = TOOL_VERBS[block.name ?? ""] ?? [
		block.name ?? "Herramienta",
		block.name ?? "Herramienta",
	];
	return `${block.result ? done : doing}${target ? ` ${target}` : ""}`;
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

/** One line of plain text: no HTML comments, math delimiters or extra spaces. */
export const snippet = (text: string) =>
	text
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\$+|\\[()[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim();

/** A stable React key for a message, whether outgoing, queued or answered. */
export const itemKey = (item: ThreadItem) =>
	item.kind === "turn"
		? item.turn.user.clientMsgId
		: item.kind === "queued"
			? item.user.clientMsgId
			: item.message.clientMsgId;
