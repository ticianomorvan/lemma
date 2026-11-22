import { readFileSync } from "node:fs";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { channel } from "./channel.ts";
import type {
	AgentDriver,
	AgentEvent,
	AgentSession,
	AgentStartOptions,
} from "./driver.ts";
import { SdkMapper } from "./map.ts";

const FIXTURES = new URL("../../../test/fixtures/streams/", import.meta.url);

/** Reads `test/fixtures/streams/<name>.jsonl`, one SDK message per line. */
export function loadStream(name: string): SDKMessage[] {
	return readFileSync(new URL(`${name}.jsonl`, FIXTURES), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as SDKMessage);
}

export type FakeDriverOptions = {
	/** Fixture names; the driver's nth push replays `streams[n % streams.length]`. */
	streams: string[];
	/**
	 * Picks the fixture for a push by its text instead; return undefined to
	 * fall back to `streams`.
	 */
	pick?: (text: string) => string | undefined;
	/**
	 * Awaited before the message at `index` of each turn's stream is replayed.
	 * Tests hold a turn mid-stream by returning a promise they resolve later.
	 */
	pace?: (index: number, turn: number) => Promise<void> | void;
};

/**
 * Replays recorded SDK streams through the same `SdkMapper` as `SdkDriver`.
 * An interrupt drops the rest of the stream and replays the `result` recorded
 * when a real turn was interrupted (`interrupt.jsonl`).
 *
 * Like the SDK, it saves a session once one of its turns reaches a `result`,
 * and only saved sessions can be resumed. Share one driver between two
 * servers to model a restart.
 */
export class FakeDriver implements AgentDriver {
	/** Every `start` and `push`, for assertions. */
	readonly started: AgentStartOptions[] = [];
	readonly pushed: string[] = [];
	/** SDK session ids with a finished turn: what `canResume` finds. */
	readonly saved = new Set<string>();
	private readonly interruptedResult = loadStream("interrupt").find(
		(m) => m.type === "result",
	);

	constructor(private readonly options: FakeDriverOptions) {}

	async canResume(sdkSessionId: string) {
		return this.saved.has(sdkSessionId);
	}

	start(start: AgentStartOptions): AgentSession {
		if (start.resume && !this.saved.has(start.sdkSessionId)) {
			throw new Error(`no saved SDK session ${start.sdkSessionId}`);
		}
		this.started.push(start);
		const saved = this.saved;
		const { streams, pace, pick } = this.options;
		const interruptedResult = this.interruptedResult;
		const pushed = this.pushed;
		const turns = channel<{ turn: number; name: string }>();
		// Turns are numbered across the driver. An interrupt is for this
		// session's latest push: a session pushes again only after `turn_end`.
		let interrupted = -1;
		let latest = -1;

		async function* events(): AsyncGenerator<AgentEvent> {
			const mapper = new SdkMapper();
			for await (const { turn, name } of turns) {
				// Loaded here, not in `push`: a missing fixture then fails the way a
				// crashed agent does, which is how tests exercise that path.
				const stream = loadStream(name);
				let cut = false;
				for (const [index, message] of stream.entries()) {
					await pace?.(index, turn);
					cut = interrupted === turn;
					if (cut) break;
					if (message.type === "result") saved.add(start.sdkSessionId);
					yield* mapper.map(message);
				}
				if (cut && interruptedResult) {
					saved.add(start.sdkSessionId);
					yield* mapper.map(interruptedResult);
				}
			}
		}

		return {
			push(text) {
				const turn = pushed.push(text) - 1;
				latest = turn;
				const name = pick?.(text) ?? streams[turn % streams.length];
				if (name === undefined) throw new Error("FakeDriver has no streams");
				turns.push({ turn, name });
			},
			async interrupt() {
				interrupted = latest;
			},
			close: () => turns.end(),
			events: events(),
		};
	}
}
