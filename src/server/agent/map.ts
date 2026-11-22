import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { BlockKind } from "../../shared/protocol.ts";
import type { AgentEvent } from "./driver.ts";

/**
 * Maps one conversation's SDK messages to our events. Raw SDK messages never
 * leave this module, so an SDK update can't change the client protocol.
 *
 * Shapes confirmed against recorded streams (SDK 0.3.330, `includePartialMessages`):
 * - Content streams as `stream_event` messages wrapping Messages API stream
 *   events. Block `index` restarts at 0 in every API message, so our block id
 *   is `<message id>:<index>`.
 * - Tool results arrive as `user` messages with `tool_result` content blocks.
 * - Each turn ends with one `result`. After `Query.interrupt()` it is
 *   `subtype: error_during_execution`, `is_error: true`,
 *   `terminal_reason: aborted_streaming` (or `aborted_tools`).
 * - Complete `assistant` messages repeat what the stream events carried, and
 *   `system`/`rate_limit_event` messages carry nothing for clients: all ignored.
 */
export class SdkMapper {
	private messageId = "";
	private readonly blocks = new Map<number, string>();
	private readonly open = new Set<string>();
	private readonly tools = new Map<string, string>();

	map(message: SDKMessage): AgentEvent[] {
		switch (message.type) {
			case "stream_event":
				if (message.parent_tool_use_id !== null) return [];
				return this.streamEvent(message.event);
			case "user":
				if (message.parent_tool_use_id !== null) return [];
				return this.toolResults(message.message.content);
			case "result":
				return this.result(message);
			default:
				return [];
		}
	}

	private streamEvent(
		event: Extract<SDKMessage, { type: "stream_event" }>["event"],
	): AgentEvent[] {
		switch (event.type) {
			case "message_start":
				this.messageId = event.message.id;
				this.blocks.clear();
				return [];
			case "content_block_start": {
				const block = event.content_block;
				const kind = blockKind(block.type);
				if (!kind) return [];
				const id = `${this.messageId}:${event.index}`;
				this.blocks.set(event.index, id);
				this.open.add(id);
				if (kind === "tool" && "id" in block && "name" in block) {
					this.tools.set(block.id, id);
					return [{ type: "block_start", id, kind, name: block.name }];
				}
				return [{ type: "block_start", id, kind }];
			}
			case "content_block_delta": {
				const id = this.blocks.get(event.index);
				const text = deltaText(event.delta);
				if (!id || !text) return [];
				return [{ type: "delta", id, text }];
			}
			case "content_block_stop": {
				const id = this.blocks.get(event.index);
				if (!id || !this.open.delete(id)) return [];
				return [{ type: "block_end", id }];
			}
			default:
				return [];
		}
	}

	private toolResults(content: unknown): AgentEvent[] {
		if (!Array.isArray(content)) return [];
		const events: AgentEvent[] = [];
		for (const part of content) {
			if (part?.type !== "tool_result") continue;
			const id = this.tools.get(part.tool_use_id);
			if (!id) continue;
			this.tools.delete(part.tool_use_id);
			events.push({
				type: "tool_result",
				id,
				ok: part.is_error !== true,
				summary: summarize(part.content),
			});
		}
		return events;
	}

	private result(
		result: Extract<SDKMessage, { type: "result" }>,
	): AgentEvent[] {
		const events: AgentEvent[] = [...this.open].map((id) => ({
			type: "block_end" as const,
			id,
		}));
		this.open.clear();
		this.tools.clear();
		const usage = {
			inputTokens:
				result.usage.input_tokens +
				(result.usage.cache_creation_input_tokens ?? 0) +
				(result.usage.cache_read_input_tokens ?? 0),
			outputTokens: result.usage.output_tokens,
		};
		// `terminal_reason` alone says whether the turn was interrupted, so no
		// driver has to remember that it asked.
		if (result.terminal_reason?.startsWith("aborted")) {
			events.push({ type: "turn_end", reason: "interrupted", usage });
		} else if (result.is_error || result.subtype !== "success") {
			const message =
				result.subtype === "success"
					? result.result
					: result.errors.join("\n") || result.subtype;
			events.push(
				{
					type: "error",
					code: result.terminal_reason ?? result.subtype,
					message,
				},
				{ type: "turn_end", reason: "error", usage },
			);
		} else {
			events.push({ type: "turn_end", reason: "completed", usage });
		}
		return events;
	}
}

function blockKind(type: string): BlockKind | null {
	switch (type) {
		case "text":
			return "text";
		case "thinking":
		case "redacted_thinking":
			return "thinking";
		case "tool_use":
		case "server_tool_use":
		case "mcp_tool_use":
			return "tool";
		default:
			return null;
	}
}

function deltaText(delta: { type: string }): string {
	if ("text" in delta && delta.type === "text_delta") return String(delta.text);
	if ("thinking" in delta) return String(delta.thinking);
	if ("partial_json" in delta) return String(delta.partial_json);
	return "";
}

/** The first non-empty line of a tool's output, at most 200 characters. */
function summarize(content: unknown): string {
	const text =
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content
						.map((part) => (part?.type === "text" ? String(part.text) : ""))
						.join("\n")
				: "";
	const line = text.split("\n").find((l) => l.trim()) ?? "";
	return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}
