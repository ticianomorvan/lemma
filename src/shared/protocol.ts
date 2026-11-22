/**
 * The wire protocol between the server and its clients: every HTTP body and
 * every WebSocket message. Both sides parse with these schemas, so a change
 * here is a protocol change. See docs/architecture.md → Client protocol.
 */
import { z } from "zod";

// ── Building blocks ──────────────────────────────────────────────────────────

export const Anchor = z.object({
	path: z.string().min(1),
	page: z.number().int().positive(),
	text: z.string(),
});
export type Anchor = z.infer<typeof Anchor>;

/** A session's front matter, as clients see it. */
export const SessionMeta = z.object({
	id: z.string(),
	course: z.string(),
	title: z.string(),
	created: z.string(),
	mode: z.string().optional(),
});
export type SessionMeta = z.infer<typeof SessionMeta>;

/** A session in the folder's list, with when its file last changed. */
export const SessionSummary = SessionMeta.extend({ updated: z.string() });
export type SessionSummary = z.infer<typeof SessionSummary>;

export const BlockKind = z.enum(["text", "thinking", "tool"]);
export type BlockKind = z.infer<typeof BlockKind>;

/** Why a turn ended. `error` covers both agent failures and API errors. */
export const TurnEndReason = z.enum(["completed", "interrupted", "error"]);
export type TurnEndReason = z.infer<typeof TurnEndReason>;

export const Usage = z.object({
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof Usage>;

// ── Session events (`e` in an `ev` message) ──────────────────────────────────

export const UserMessageEvent = z.object({
	type: z.literal("user_message"),
	turnId: z.string(),
	clientMsgId: z.string(),
	/** The device that sent it. Until auth (step 4) every sender is `local`. */
	from: z.string(),
	text: z.string(),
	anchor: Anchor.optional(),
	attachments: z.array(z.string()),
	/** True when another turn was running or waiting when it arrived. */
	queued: z.boolean(),
});

export const NoteEvent = z.object({
	type: z.literal("note"),
	id: z.string(),
	anchor: Anchor,
	text: z.string().optional(),
});

export const TurnStartEvent = z.object({
	type: z.literal("turn_start"),
	turnId: z.string(),
});

export const BlockStartEvent = z.object({
	type: z.literal("block_start"),
	id: z.string(),
	kind: BlockKind,
	/** The tool's name, for `kind: tool`. */
	name: z.string().optional(),
});

export const DeltaEvent = z.object({
	type: z.literal("delta"),
	id: z.string(),
	/** Text for `text` and `thinking` blocks; partial JSON input for `tool`. */
	text: z.string(),
});

export const BlockEndEvent = z.object({
	type: z.literal("block_end"),
	id: z.string(),
});

export const ToolResultEvent = z.object({
	type: z.literal("tool_result"),
	/** The id of the `tool` block this result answers. */
	id: z.string(),
	ok: z.boolean(),
	summary: z.string(),
});

export const TurnEndEvent = z.object({
	type: z.literal("turn_end"),
	turnId: z.string(),
	reason: TurnEndReason,
	usage: Usage,
});

/** The session's title or mode changed. */
export const MetaEvent = z.object({
	type: z.literal("meta"),
	meta: SessionMeta,
});

export const ErrorEvent = z.object({
	type: z.literal("error"),
	code: z.string(),
	message: z.string(),
	clientMsgId: z.string().optional(),
});

export const SessionEvent = z.discriminatedUnion("type", [
	UserMessageEvent,
	NoteEvent,
	TurnStartEvent,
	BlockStartEvent,
	DeltaEvent,
	BlockEndEvent,
	ToolResultEvent,
	TurnEndEvent,
	MetaEvent,
	ErrorEvent,
]);
export type SessionEvent = z.infer<typeof SessionEvent>;
export type SessionEventOf<T extends SessionEvent["type"]> = Extract<
	SessionEvent,
	{ type: T }
>;

// ── View state (what the reducer builds, and what a snapshot carries) ────────

export const Block = z.object({
	id: z.string(),
	kind: BlockKind,
	name: z.string().optional(),
	text: z.string(),
	done: z.boolean(),
	result: z.object({ ok: z.boolean(), summary: z.string() }).optional(),
});
export type Block = z.infer<typeof Block>;

export const UserMessage = UserMessageEvent.omit({ type: true, queued: true });
export type UserMessage = z.infer<typeof UserMessage>;

export const Turn = z.object({
	id: z.string(),
	user: UserMessage,
	blocks: z.array(Block),
	/** Set once the turn has ended. */
	end: z.object({ reason: TurnEndReason, usage: Usage }).optional(),
});
export type Turn = z.infer<typeof Turn>;

export const Note = NoteEvent.omit({ type: true });
export type Note = z.infer<typeof Note>;

export const SessionStatus = z.enum(["idle", "running"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SessionView = z.object({
	status: SessionStatus,
	meta: SessionMeta,
	/** Finished turns, oldest first. */
	turns: z.array(Turn),
	/** The turn the agent is answering now. */
	inflight: Turn.optional(),
	/** Messages waiting for their turn, in arrival order. */
	queue: z.array(UserMessage),
	notes: z.array(Note),
	/** The running or last turn's error; cleared when the next turn starts. */
	error: ErrorEvent.omit({ type: true }).optional(),
});
export type SessionView = z.infer<typeof SessionView>;

// ── WebSocket ────────────────────────────────────────────────────────────────

export const ClientMessage = z.object({
	t: z.enum(["sub", "unsub"]),
	session: z.string(),
});
export type ClientMessage = z.infer<typeof ClientMessage>;

export const SnapshotMessage = SessionView.extend({
	t: z.literal("snapshot"),
	session: z.string(),
	/** Changes when the server restarts; a client re-subscribes on a change. */
	epoch: z.number(),
	/** The seq of the last event folded into this snapshot. */
	seq: z.number().int().nonnegative(),
});
export type SnapshotMessage = z.infer<typeof SnapshotMessage>;

export const EventMessage = z.object({
	t: z.literal("ev"),
	session: z.string(),
	epoch: z.number(),
	seq: z.number().int().positive(),
	e: SessionEvent,
});
export type EventMessage = z.infer<typeof EventMessage>;

/** A file in the study folder changed outside the app. Sent to every socket. */
export const FolderMessage = z.object({
	t: z.literal("folder"),
	/** Relative to the study root, with `/` separators. */
	path: z.string(),
	kind: z.enum(["change", "rename"]),
});

/** A `sub` the server can't serve, such as an unknown session. */
export const SubErrorMessage = z.object({
	t: z.literal("error"),
	session: z.string().optional(),
	code: z.string(),
	message: z.string(),
});

export const ServerMessage = z.discriminatedUnion("t", [
	SnapshotMessage,
	EventMessage,
	FolderMessage,
	SubErrorMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

// ── HTTP bodies ──────────────────────────────────────────────────────────────

export const CreateSessionBody = z.object({
	course: z.string().min(1).max(200),
	title: z.string().max(200).optional(),
	mode: z.string().min(1).max(64).optional(),
});
export type CreateSessionBody = z.infer<typeof CreateSessionBody>;

export const CreateSessionResponse = z.object({ id: z.string() });
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>;

export const PatchSessionBody = z
	.object({
		title: z.string().max(200).optional(),
		/** Null clears the mode. */
		mode: z.string().min(1).max(64).nullable().optional(),
	})
	.refine((b) => b.title !== undefined || b.mode !== undefined, {
		message: "send a title or a mode",
	});
export type PatchSessionBody = z.infer<typeof PatchSessionBody>;

export const SendMessageBody = z.object({
	clientMsgId: z.string().min(1).max(100),
	text: z.string().min(1).max(100_000),
	anchor: Anchor.optional(),
	attachmentIds: z.array(z.string()).max(20).optional(),
});
export type SendMessageBody = z.infer<typeof SendMessageBody>;

export const SendMessageResponse = z.object({
	turnId: z.string(),
	queued: z.boolean(),
});
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;

export const InterruptResponse = z.object({
	/** False when no turn was running. */
	interrupted: z.boolean(),
});
export type InterruptResponse = z.infer<typeof InterruptResponse>;

export const StateResponse = z.object({
	/** The study folder, or null until the first-run screen sets one. */
	folder: z.string().nullable(),
	/** The folder's top-level folders. */
	courses: z.array(z.string()),
	/** Every session in the folder, oldest first. */
	sessions: z.array(SessionSummary),
});
export type StateResponse = z.infer<typeof StateResponse>;

export const SetFolderBody = z.object({
	/** An absolute path, or one starting with `~/`. Made if it doesn't exist. */
	path: z.string().min(1).max(1024),
});
export type SetFolderBody = z.infer<typeof SetFolderBody>;

export const ErrorResponse = z.object({
	error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;
