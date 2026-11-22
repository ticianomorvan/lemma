import type { SessionEventOf } from "../../shared/protocol.ts";

/**
 * The agent behind a session, as the sessions module sees it. `SdkDriver` runs
 * Claude through the Agent SDK; `FakeDriver` replays recorded SDK streams so
 * tests run offline. Both map SDK messages with `SdkMapper`, so they emit the
 * same events for the same stream.
 */
export interface AgentDriver {
	start(options: AgentStartOptions): AgentSession;
}

export type AgentStartOptions = {
	/** Our session id, passed to the SDK as its session id. */
	sessionId: string;
	/** An SDK session to resume instead of starting a fresh one. */
	resume?: string;
};

/** One live agent conversation. Each `push` gets exactly one `turn_end`. */
export interface AgentSession {
	/** Sends one user message. Call again only after the previous `turn_end`. */
	push(text: string): void;
	/** Stops the running turn, which then ends with `reason: interrupted`. */
	interrupt(): Promise<void>;
	/** Ends the conversation; `events` finishes. */
	close(): void;
	events: AsyncIterable<AgentEvent>;
}

/** Session events without the ids that only the sessions module knows. */
export type AgentEvent =
	| SessionEventOf<"block_start" | "delta" | "block_end" | "tool_result">
	| Omit<SessionEventOf<"turn_end">, "turnId">
	| Omit<SessionEventOf<"error">, "clientMsgId">;
