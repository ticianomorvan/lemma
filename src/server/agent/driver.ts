import type { SessionEventOf } from "../../shared/protocol.ts";
import type { Folder } from "../folder/folder.ts";

/**
 * The agent behind a session, as the sessions module sees it. `SdkDriver` runs
 * Claude through the Agent SDK; `FakeDriver` replays recorded SDK streams so
 * tests run offline. Both map SDK messages with `SdkMapper`, so they emit the
 * same events for the same stream.
 */
export interface AgentDriver {
	/**
	 * Resumes `resumeId` when the SDK still has that session saved; otherwise
	 * starts a fresh SDK session (with a new id) and sends `seed` ahead of its
	 * first message.
	 */
	start(options: AgentStartOptions): Promise<AgentSession>;
}

export type AgentStartOptions = {
	/** The study folder: the agent's working directory and its path jail. */
	folder: Folder;
	/** The SDK session to continue, if it still exists. */
	resumeId?: string;
	/**
	 * For a fresh start over an existing transcript: the conversation so far,
	 * so Claude has the history.
	 */
	seed?: string;
};

/** One live agent conversation. Each `push` gets exactly one `turn_end`. */
export interface AgentSession {
	/** The SDK session it runs in: `resumeId` when resumed, else a new one. */
	sdkSessionId: string;
	/** Whether it continued a saved session. */
	resumed: boolean;
	/**
	 * Sends one user message, with photos as `image` blocks ahead of its text.
	 * Call again only after the previous `turn_end`.
	 */
	push(text: string, images?: AgentImage[]): void;
	/** Stops the running turn, which then ends with `reason: interrupted`. */
	interrupt(): Promise<void>;
	/** Ends the conversation; `events` finishes. */
	close(): void;
	events: AsyncIterable<AgentEvent>;
}

/** A photo for Claude: its bytes, base64, and its type. */
export type AgentImage = {
	mediaType: "image/jpeg" | "image/png";
	data: string;
};

/** Session events without the ids that only the sessions module knows. */
export type AgentEvent =
	| SessionEventOf<"block_start" | "delta" | "block_end" | "tool_result">
	| Omit<SessionEventOf<"turn_end">, "turnId">
	| Omit<SessionEventOf<"error">, "clientMsgId">;
