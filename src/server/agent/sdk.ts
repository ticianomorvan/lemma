import {
	type Options,
	query,
	type SDKMessage,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { channel } from "./channel.ts";
import type {
	AgentDriver,
	AgentEvent,
	AgentSession,
	AgentStartOptions,
} from "./driver.ts";
import { SdkMapper } from "./map.ts";
import { CONVENTIONS } from "./prompt.ts";

/**
 * Read-only until the folder module's path jail exists (step 3), which is
 * when `Write` and `Edit` join.
 */
const TOOLS = ["Read", "Glob", "Grep"];

/** Runs Claude with the Agent SDK: one streaming `query()` per session. */
export class SdkDriver implements AgentDriver {
	constructor(private readonly cwd: string) {}

	start({ sessionId, resume }: AgentStartOptions): AgentSession {
		const input = channel<SDKUserMessage>();
		const conversation = query({
			prompt: input,
			options: sdkOptions(this.cwd, resume ? { resume } : { sessionId }),
		});
		return {
			push(text) {
				input.push({
					type: "user",
					message: { role: "user", content: text },
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
}

/** The options every session runs with. Exported for the fixture recorder. */
export function sdkOptions(
	cwd: string,
	session: Pick<Options, "sessionId" | "resume">,
): Options {
	return {
		...session,
		cwd,
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
		// Not `allowedTools`: a bare entry there approves the tool before this
		// callback runs, and step 3 puts the path jail here.
		canUseTool: async (name, input) =>
			TOOLS.includes(name)
				? { behavior: "allow", updatedInput: input }
				: { behavior: "deny", message: `${name} is not available in Lemma` },
	};
}

async function* mapStream(
	messages: AsyncIterable<SDKMessage>,
): AsyncGenerator<AgentEvent> {
	const mapper = new SdkMapper();
	for await (const message of messages) yield* mapper.map(message);
}
