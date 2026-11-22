import {
	getSessionInfo,
	type Options,
	query,
	type SDKMessage,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Folder } from "../folder/folder.ts";
import { channel } from "./channel.ts";
import type {
	AgentDriver,
	AgentEvent,
	AgentSession,
	AgentStartOptions,
} from "./driver.ts";
import { SdkMapper } from "./map.ts";
import { CONVENTIONS } from "./prompt.ts";
import { checkTool, TOOLS } from "./tools.ts";

/** Runs Claude with the Agent SDK: one streaming `query()` per session. */
export class SdkDriver implements AgentDriver {
	start({
		folder,
		sdkSessionId,
		resume,
		seed,
	}: AgentStartOptions): AgentSession {
		const input = channel<SDKUserMessage>();
		const conversation = query({
			prompt: input,
			options: sdkOptions(
				folder,
				resume ? { resume: sdkSessionId } : { sessionId: sdkSessionId },
			),
		});
		let pending = resume ? undefined : seed;
		return {
			push(text) {
				// The seed goes with the first message, so it is part of the saved
				// history a later resume brings back (a system prompt wouldn't be).
				const content = pending
					? [
							{ type: "text" as const, text: pending },
							{ type: "text" as const, text },
						]
					: text;
				pending = undefined;
				input.push({
					type: "user",
					message: { role: "user", content },
					parent_tool_use_id: null,
				});
			},
			async interrupt() {
				await conversation.interrupt();
			},
			close() {
				input.end();
				conversation.close();
			},
			events: mapStream(conversation),
		};
	}

	async canResume(sdkSessionId: string, folder: Folder) {
		const info = await getSessionInfo(sdkSessionId, { dir: folder.root });
		return info !== undefined;
	}
}

/** The options every session runs with. Exported for the fixture recorder. */
export function sdkOptions(
	folder: Folder,
	session: Pick<Options, "sessionId" | "resume">,
): Options {
	const deny = (name: string, input: unknown) =>
		checkTool(folder, name, (input ?? {}) as Record<string, unknown>);
	return {
		...session,
		cwd: folder.root,
		// Project settings only: loads the folder's `.claude/skills` and keeps
		// the user's global hooks and MCP servers out.
		settingSources: ["project"],
		systemPrompt: {
			type: "preset",
			preset: "claude_code",
			append: CONVENTIONS,
		},
		includePartialMessages: true,
		// Summaries stream as thinking deltas; without `display` they stream
		// empty. The thread shows them folded under a "Pensando" row.
		thinking: { type: "adaptive", display: "summarized" },
		tools: TOOLS,
		disallowedTools: ["Bash", "NotebookEdit", "Task"],
		// The path jail runs on every call: the SDK approves reads inside `cwd`
		// without calling `canUseTool`, but never skips this hook.
		hooks: {
			PreToolUse: [
				{
					hooks: [
						async (hook) => {
							if (hook.hook_event_name !== "PreToolUse") return {};
							const reason = deny(hook.tool_name, hook.tool_input);
							return reason
								? {
										hookSpecificOutput: {
											hookEventName: "PreToolUse",
											permissionDecision: "deny",
											permissionDecisionReason: reason,
										},
									}
								: {};
						},
					],
				},
			],
		},
		// Not `allowedTools`: a bare entry there approves the tool before this
		// callback runs. Writes ask here, and the jail is checked once more.
		canUseTool: async (name, input) => {
			const reason = deny(name, input);
			return reason
				? { behavior: "deny", message: reason }
				: { behavior: "allow", updatedInput: input };
		},
	};
}

async function* mapStream(
	messages: AsyncIterable<SDKMessage>,
): AsyncGenerator<AgentEvent> {
	const mapper = new SdkMapper();
	for await (const message of messages) yield* mapper.map(message);
}
