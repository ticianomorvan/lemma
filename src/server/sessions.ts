/**
 * Live sessions, in memory until the transcript files arrive (step 3). Each
 * session queues messages in arrival order, runs one agent turn at a time, and
 * publishes every event to the topic `s:<id>` with a gapless `seq`.
 */
import type {
	CreateSessionBody,
	SendMessageBody,
	SendMessageResponse,
	ServerMessage,
	SessionEvent,
	SessionMeta,
	SessionView,
	SnapshotMessage,
} from "../shared/protocol.ts";
import { apply, emptyView } from "../shared/reducer.ts";
import type { AgentDriver, AgentSession } from "./agent/driver.ts";

export type Publish = (topic: string, message: ServerMessage) => void;

type LiveSession = {
	view: SessionView;
	/** The seq of the last event published. */
	seq: number;
	agent?: AgentSession;
	/** Set once an agent has run; later agents resume its SDK session. */
	started: boolean;
	/** An interrupt the agent hasn't acknowledged yet. */
	interrupting?: Promise<void>;
};

const NO_USAGE = { inputTokens: 0, outputTokens: 0 };

export const topic = (id: string) => `s:${id}`;

export class Sessions {
	/** Changes on every start, so clients can tell the server restarted. */
	readonly epoch = Date.now();
	private readonly live = new Map<string, LiveSession>();

	constructor(
		private readonly driver: AgentDriver,
		private readonly publish: Publish,
	) {}

	create({ course, title, mode }: CreateSessionBody): SessionMeta {
		const meta: SessionMeta = {
			id: crypto.randomUUID(),
			course,
			title: title ?? "",
			created: new Date().toISOString(),
			...(mode === undefined ? {} : { mode }),
		};
		this.live.set(meta.id, { view: emptyView(meta), seq: 0, started: false });
		return meta;
	}

	list(): SessionMeta[] {
		return [...this.live.values()].map((s) => s.view.meta);
	}

	snapshot(id: string): SnapshotMessage | undefined {
		const s = this.live.get(id);
		if (!s) return undefined;
		return {
			t: "snapshot",
			session: id,
			epoch: this.epoch,
			seq: s.seq,
			...s.view,
		};
	}

	/** Queues a message; it is answered after every message that arrived before it. */
	send(id: string, body: SendMessageBody): SendMessageResponse | undefined {
		const s = this.live.get(id);
		if (!s) return undefined;
		const turnId = crypto.randomUUID();
		const queued = s.view.status === "running" || s.view.queue.length > 0;
		this.emit(id, s, {
			type: "user_message",
			turnId,
			clientMsgId: body.clientMsgId,
			from: "local",
			text: body.text,
			...(body.anchor === undefined ? {} : { anchor: body.anchor }),
			attachments: body.attachmentIds ?? [],
			queued,
		});
		this.next(id, s);
		return { turnId, queued };
	}

	/** Stops the running turn. False when nothing was running. */
	async interrupt(id: string): Promise<boolean | undefined> {
		const s = this.live.get(id);
		if (!s) return undefined;
		if (!s.view.inflight || !s.agent) return false;
		// `next` waits for this before pushing, so an interrupt that races the
		// turn's end can't land on the next queued turn.
		const pending = s.agent.interrupt().catch(() => {});
		s.interrupting = pending;
		await pending;
		if (s.interrupting === pending) s.interrupting = undefined;
		return true;
	}

	close() {
		for (const s of this.live.values()) s.agent?.close();
		this.live.clear();
	}

	/** Starts the next queued turn if the agent is free. */
	private next(id: string, s: LiveSession) {
		const user = s.view.queue[0];
		if (s.view.inflight || !user) return;
		this.emit(id, s, { type: "turn_start", turnId: user.turnId });
		const push = () => {
			if (this.live.get(id) !== s || s.view.inflight?.id !== user.turnId) {
				return;
			}
			let agent = s.agent;
			try {
				if (!agent) {
					agent = this.driver.start(
						s.started ? { sessionId: id, resume: id } : { sessionId: id },
					);
					s.agent = agent;
					s.started = true;
					void this.run(id, s, agent);
				}
				agent.push(user.text);
			} catch (error) {
				if (agent) this.fail(id, s, agent, String(error));
				else this.endWithError(id, s, String(error));
			}
		};
		if (s.interrupting) void s.interrupting.then(push);
		else push();
	}

	/** Publishes the agent's events until it closes or fails. */
	private async run(id: string, s: LiveSession, agent: AgentSession) {
		try {
			for await (const event of agent.events) {
				if (this.live.get(id) !== s) return;
				if (event.type === "turn_end") {
					const turnId = s.view.inflight?.id;
					if (!turnId) continue;
					this.emit(id, s, { ...event, turnId });
					this.next(id, s);
				} else {
					this.emit(id, s, event);
				}
			}
			this.fail(id, s, agent, "the agent stopped");
		} catch (error) {
			this.fail(id, s, agent, String(error));
		}
	}

	/** Ends the running turn with an error; the next send starts a new agent. */
	private fail(
		id: string,
		s: LiveSession,
		agent: AgentSession,
		message: string,
	) {
		if (s.agent !== agent || this.live.get(id) !== s) return;
		s.agent = undefined;
		agent.close();
		this.endWithError(id, s, message);
	}

	private endWithError(id: string, s: LiveSession, message: string) {
		const turnId = s.view.inflight?.id;
		if (!turnId) return;
		this.emit(id, s, { type: "error", code: "agent_failed", message });
		this.emit(id, s, {
			type: "turn_end",
			turnId,
			reason: "error",
			usage: NO_USAGE,
		});
		this.next(id, s);
	}

	private emit(id: string, s: LiveSession, e: SessionEvent) {
		s.seq += 1;
		s.view = apply(s.view, e);
		this.publish(topic(id), {
			t: "ev",
			session: id,
			epoch: this.epoch,
			seq: s.seq,
			e,
		});
	}
}
