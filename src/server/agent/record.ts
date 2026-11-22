/**
 * Records a real SDK stream as a FakeDriver fixture, using your own Claude
 * login. Run from the repo root:
 *
 *   bun run record:stream <name> "<prompt>" [--interrupt-after <deltas>]
 *
 * It runs one turn in a scratch study folder holding `notas.md`, then writes
 * `test/fixtures/streams/<name>.jsonl`. Only the message types the mapper
 * reads are kept; session, request and account details are dropped, and
 * message ids are renumbered.
 * Paths stay as recorded, which is why the folder lives under /tmp. Read the
 * diff before committing it.
 */
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
	query,
	type SDKMessage,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { Folder } from "../folder/folder.ts";
import { sdkOptions } from "./sdk.ts";

const KEPT = new Set(["stream_event", "assistant", "user", "result"]);
const RESULT_KEYS = [
	"type",
	"subtype",
	"is_error",
	"num_turns",
	"stop_reason",
	"terminal_reason",
	"duration_ms",
	"duration_api_ms",
	"usage",
	"result",
	"errors",
	"session_id",
	"uuid",
];
const SESSION_ID = "00000000-0000-4000-8000-000000000000";
const messageIds = new Map<string, string>();

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: { "interrupt-after": { type: "string" } },
});
const [name, prompt] = positionals;
if (!name || !prompt) {
	console.error(
		'usage: bun run record:stream <name> "<prompt>" [--interrupt-after <deltas>]',
	);
	process.exit(1);
}
const interruptAfter = Number(values["interrupt-after"] ?? Infinity);

// Under /tmp, not the per-user temp dir: tool input streams the path in
// chunks that no string replace can scrub, so the path itself must be neutral.
const cwd = await realpath(await mkdtemp("/tmp/lemma-record-"));
await writeFile(
	join(cwd, "notas.md"),
	"# Notas\n\nLa varianza de una Bernoulli es $p(1-p)$.\n",
);

let finish = () => {};
async function* input(): AsyncGenerator<SDKUserMessage> {
	yield {
		type: "user",
		message: { role: "user", content: prompt as string },
		parent_tool_use_id: null,
	};
	await new Promise<void>((resolve) => (finish = resolve));
}

const conversation = query({
	prompt: input(),
	options: sdkOptions(new Folder(cwd), { sessionId: crypto.randomUUID() }),
});
const lines: string[] = [];
let deltas = 0;
for await (const message of conversation) {
	const kept = scrub(message);
	if (kept) lines.push(kept);
	if (
		message.type === "stream_event" &&
		message.event.type === "content_block_delta" &&
		++deltas === interruptAfter
	) {
		await conversation.interrupt();
	}
	if (message.type === "result") break;
}
finish();
conversation.close();
await rm(cwd, { recursive: true });

const out = new URL(
	`../../../test/fixtures/streams/${name}.jsonl`,
	import.meta.url,
);
await writeFile(out, `${lines.join("\n")}\n`);
console.log(`wrote ${lines.length} messages to ${out.pathname}`);

function scrub(message: SDKMessage): string | null {
	if (!KEPT.has(message.type)) return null;
	let value: Record<string, unknown> = { ...message };
	if (message.type === "result") {
		value = Object.fromEntries(
			RESULT_KEYS.filter((k) => k in message).map((k) => [
				k,
				(message as Record<string, unknown>)[k],
			]),
		);
	}
	// The structured tool output repeats the content with absolute paths.
	delete value.tool_use_result;
	delete value.tool_result_meta;
	delete value.request_id;
	value.session_id = SESSION_ID;
	// Real message ids look like API keys to secret scanners; any stable,
	// distinct id serves (block ids derive from it).
	return JSON.stringify(value).replace(/\bmsg_[A-Za-z0-9]+/g, (real) => {
		if (!messageIds.has(real))
			messageIds.set(real, `msg_${messageIds.size + 1}`);
		return messageIds.get(real) as string;
	});
}
