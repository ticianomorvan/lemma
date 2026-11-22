/**
 * Sessions, each one a Markdown transcript at `<course>/sessions/<date>-<slug>.md`
 * (see docs/architecture.md → Sessions and the source of truth). A session is
 * loaded from its file when first used, then queues messages in arrival order,
 * runs one agent turn at a time, and publishes every event to the topic
 * `s:<id>` with a gapless `seq`.
 *
 * - The transcript gets the question when its turn starts and the answer
 *   when its turn ends, each appended to the file as it is on disk then.
 * - An agent starts on the first send. It resumes the SDK session named in the
 *   front matter only when the SDK still has it and the body hash matches;
 *   otherwise it starts fresh, seeded with the transcript.
 * - An agent idle for `idleMs` is closed; its session stays loaded.
 */
import type {
	CreateSessionBody,
	PatchSessionBody,
	SendMessageBody,
	SendMessageResponse,
	ServerMessage,
	SessionEvent,
	SessionMeta,
	SessionSummary,
	SessionView,
	SnapshotMessage,
	Turn,
	TurnEndReason,
} from "../shared/protocol.ts";
import { apply, emptyView } from "../shared/reducer.ts";
import type { AgentDriver, AgentSession } from "./agent/driver.ts";
import type { Folder, FolderChange } from "./folder/folder.ts";
import { isCourse, isCourseName, sessionsDir } from "./folder/layout.ts";
import {
	appendEntry,
	bodyHash,
	format,
	parseBody,
	read,
	split,
	type Transcript,
	type TranscriptMeta,
	write,
} from "./transcript/transcript.ts";

export type Publish = (topic: string, message: ServerMessage) => void;

export type SessionsOptions = {
	driver: AgentDriver;
	folder: Folder;
	publish: Publish;
	/** How long an agent may sit idle before it is closed (10 minutes). */
	idleMs?: number;
};

type LiveSession = {
	/** The transcript's path, relative to the study root. */
	path: string;
	view: SessionView;
	/** The seq of the last event published. */
	seq: number;
	agent?: AgentSession;
	/**
	 * `bodyHash` of the transcript as the live agent knows it. A file that no
	 * longer matches was edited under it, and the next turn starts over.
	 */
	agentHash?: string;
	/** An interrupt the agent hasn't acknowledged yet. */
	interrupting?: Promise<void>;
	/** A turn stopped before its agent existed; interrupted once it does. */
	cancel?: string;
	idle?: ReturnType<typeof setTimeout>;
};

const NO_USAGE = { inputTokens: 0, outputTokens: 0 };
const IDLE_MS = 10 * 60 * 1000;

export const topic = (id: string) => `s:${id}`;

export class Sessions {
	/** Changes on every start, so clients can tell the server restarted. */
	readonly epoch = Date.now();
	private readonly live = new Map<string, LiveSession>();
	/** Session id → transcript path, refreshed by `list`. */
	private readonly paths = new Map<string, string>();
	private readonly driver: AgentDriver;
	private readonly folder: Folder;
	private readonly publish: Publish;
	private readonly idleMs: number;

	constructor({ driver, folder, publish, idleMs = IDLE_MS }: SessionsOptions) {
		this.driver = driver;
		this.folder = folder;
		this.publish = publish;
		this.idleMs = idleMs;
	}

	/** The courses: the study folder's top-level folders. */
	courses(): string[] {
		return this.folder
			.list()
			.filter((e) => e.dir && isCourse(e.name))
			.map((e) => e.name);
	}

	/** Every session in the folder, oldest first, read from the front matter. */
	list(): SessionSummary[] {
		const sessions: SessionSummary[] = [];
		this.paths.clear();
		for (const course of this.courses()) {
			let files: ReturnType<Folder["list"]>;
			try {
				files = this.folder.list(sessionsDir(course));
			} catch {
				// `sessions` is a file, unreadable, or a link out of the folder.
				continue;
			}
			for (const file of files) {
				if (file.dir || !file.name.endsWith(".md")) continue;
				const path = `${sessionsDir(course)}/${file.name}`;
				try {
					const { meta } = split(this.folder.read(path));
					if (this.paths.has(meta.id)) continue;
					this.paths.set(meta.id, path);
					sessions.push({
						...clientMeta(meta),
						updated: this.folder.modified(path).toISOString(),
					});
				} catch {
					// Not a transcript (or a broken one): not a session.
				}
			}
		}
		return sessions.sort((a, b) => a.created.localeCompare(b.created));
	}

	/** Writes a new, empty transcript; its course folder is made if needed. */
	create({ course, title, mode }: CreateSessionBody): SessionMeta {
		if (!isCourseName(course)) throw new BadRequest("not a course name");
		const meta: TranscriptMeta = {
			id: crypto.randomUUID(),
			course,
			title: title?.trim() ?? "",
			created: new Date().toISOString(),
			...(mode === undefined ? {} : { mode }),
		};
		const path = this.freePath(meta);
		this.folder.writeAtomic(path, format(meta));
		this.paths.set(meta.id, path);
		return clientMeta(meta);
	}

	snapshot(id: string): SnapshotMessage | undefined {
		const s = this.load(id);
		return s && this.snapshotOf(id, s);
	}

	/** Queues a message; it is answered after every message that arrived before it. */
	send(id: string, body: SendMessageBody): SendMessageResponse | undefined {
		const s = this.load(id);
		if (!s) return undefined;
		const turnId = crypto.randomUUID();
		const queued = s.view.status === "running" || s.view.queue.length > 0;
		// The question itself is written when its turn starts, so each answer
		// follows its own question in the file even when messages queue up.
		if (!s.view.meta.title) this.update(id, { title: titleFrom(body.text) });
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

	/** Changes the title or mode in the front matter. */
	update(id: string, body: PatchSessionBody): SessionMeta | undefined {
		const s = this.load(id);
		if (!s) return undefined;
		const patch: Partial<TranscriptMeta> = {};
		if (body.title !== undefined) patch.title = body.title.trim();
		if (body.mode !== undefined) patch.mode = body.mode ?? undefined;
		const current = read(this.folder, s.path);
		write(this.folder, s.path, {
			meta: { ...current.meta, ...patch },
			body: current.body,
		});
		this.emitMeta(id, s, patch);
		return s.view.meta;
	}

	/** Stops the running turn. False when nothing was running. */
	async interrupt(id: string): Promise<boolean | undefined> {
		const s = this.load(id);
		if (!s) return undefined;
		if (!s.view.inflight) return false;
		if (!s.agent) {
			// Its agent is still starting: interrupt as soon as it exists.
			s.cancel = s.view.inflight.id;
			return true;
		}
		// `next` waits for this before pushing, so an interrupt that races the
		// turn's end can't land on the next queued turn.
		const pending = s.agent.interrupt().catch(() => {});
		s.interrupting = pending;
		await pending;
		if (s.interrupting === pending) s.interrupting = undefined;
		return true;
	}

	/**
	 * A file changed outside the app. An idle session whose transcript it is
	 * reloads from disk and pushes the new snapshot to its clients. (Its agent
	 * notices the edit by hash when the next turn starts.)
	 */
	changed({ path }: FolderChange) {
		for (const [id, s] of this.live) {
			if (s.path !== path || s.view.inflight || s.view.queue.length > 0) {
				continue;
			}
			try {
				s.view = viewOf(read(this.folder, path), id);
			} catch {
				continue;
			}
			s.seq += 1;
			this.publish(topic(id), this.snapshotOf(id, s));
		}
	}

	close() {
		for (const s of this.live.values()) this.stop(s);
		this.live.clear();
	}

	private load(id: string): LiveSession | undefined {
		const loaded = this.live.get(id);
		if (loaded) return loaded;
		if (!this.paths.has(id)) this.list();
		const path = this.paths.get(id);
		if (!path) return undefined;
		let view: SessionView;
		try {
			view = viewOf(read(this.folder, path), id);
		} catch {
			return undefined;
		}
		const s: LiveSession = { path, view, seq: 0 };
		this.live.set(id, s);
		return s;
	}

	/**
	 * Starts the next queued turn if the agent is free. Its question is
	 * appended to the file as it is on disk now; what that file looked like
	 * just before decides how the agent continues:
	 * - a live agent whose hash no longer matches is closed (the file was edited);
	 * - a new agent may resume the SDK session in the front matter only if
	 *   `sdk_body_hash` matches the body; otherwise it is seeded with the body.
	 */
	private next(id: string, s: LiveSession) {
		const user = s.view.queue[0];
		if (s.view.inflight || !user) return;
		clearTimeout(s.idle);
		this.emit(id, s, { type: "turn_start", turnId: user.turnId });
		let start: { resumeId?: string; seed?: string };
		let asked: string;
		try {
			const before = read(this.folder, s.path);
			const hash = bodyHash(before.body);
			if (s.agent && hash !== s.agentHash) this.stop(s);
			const { sdk_session_id, sdk_body_hash } = before.meta;
			const history = before.body.trim();
			start = {
				...(sdk_session_id && sdk_body_hash === hash
					? { resumeId: sdk_session_id }
					: {}),
				...(history ? { seed: seedFrom(history) } : {}),
			};
			const after = appendEntry(before, {
				kind: "user",
				text: user.text,
				...(user.anchor === undefined ? {} : { anchor: user.anchor }),
			});
			write(this.folder, s.path, after);
			asked = bodyHash(after.body);
			if (s.agent) s.agentHash = asked;
		} catch (error) {
			// The transcript is the truth: no turn without its question in it.
			return this.endWithError(id, s, `could not write ${s.path}: ${error}`);
		}
		const current = () =>
			this.live.get(id) === s && s.view.inflight?.id === user.turnId;
		const push = async () => {
			if (!current()) return;
			let agent = s.agent;
			try {
				if (!agent) {
					agent = await this.driver.start({ folder: this.folder, ...start });
					if (!current()) return agent.close();
					s.agent = agent;
					s.agentHash = asked;
					void this.run(id, s, agent);
				}
				agent.push(user.text);
				if (s.cancel === user.turnId) {
					s.cancel = undefined;
					void this.interrupt(id);
				}
			} catch (error) {
				if (agent && s.agent === agent) this.fail(id, s, agent, String(error));
				else this.endWithError(id, s, String(error));
			}
		};
		if (s.interrupting) void s.interrupting.then(push);
		else void push();
	}

	/** Publishes the agent's events until it closes or fails. */
	private async run(id: string, s: LiveSession, agent: AgentSession) {
		try {
			for await (const event of agent.events) {
				if (this.live.get(id) !== s || s.agent !== agent) return;
				if (event.type === "turn_end") {
					const turn = s.view.inflight;
					if (!turn) continue;
					this.finish(s, turn, event.reason);
					this.emit(id, s, { ...event, turnId: turn.id });
					this.next(id, s);
					this.idleLater(id, s);
				} else {
					this.emit(id, s, event);
				}
			}
			this.fail(id, s, agent, "the agent stopped");
		} catch (error) {
			this.fail(id, s, agent, String(error));
		}
	}

	/**
	 * Appends a turn's answer. If a live agent saw exactly the file it is
	 * appended to, the front matter records its SDK session and the new body
	 * hash, which is what lets a later start resume. A failed turn, or one the
	 * file was edited during, records nothing, so the next start reseeds.
	 */
	private finish(s: LiveSession, turn: Turn, reason: TurnEndReason) {
		const text = turn.blocks
			.filter((b) => b.kind === "text")
			.map((b) => b.text.trim())
			.filter(Boolean)
			.join("\n\n");
		try {
			const before = read(this.folder, s.path);
			const after = appendEntry(before, { kind: "answer", text, reason });
			const agent = s.agent;
			if (agent && bodyHash(before.body) === s.agentHash) {
				s.agentHash = bodyHash(after.body);
				after.meta = {
					...after.meta,
					sdk_session_id: agent.sdkSessionId,
					sdk_body_hash: s.agentHash,
				};
			}
			write(this.folder, s.path, after);
		} catch (error) {
			console.error(`could not write ${s.path}:`, error);
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
		this.stop(s);
		this.endWithError(id, s, message);
	}

	private endWithError(id: string, s: LiveSession, message: string) {
		const turn = s.view.inflight;
		if (!turn) return;
		this.finish(s, turn, "error");
		this.emit(id, s, { type: "error", code: "agent_failed", message });
		this.emit(id, s, {
			type: "turn_end",
			turnId: turn.id,
			reason: "error",
			usage: NO_USAGE,
		});
		this.next(id, s);
	}

	/** Closes the agent once the session has been idle for `idleMs`. */
	private idleLater(id: string, s: LiveSession) {
		clearTimeout(s.idle);
		if (s.view.inflight || !s.agent) return;
		s.idle = setTimeout(() => {
			if (this.live.get(id) === s && !s.view.inflight) this.stop(s);
		}, this.idleMs);
	}

	private stop(s: LiveSession) {
		clearTimeout(s.idle);
		const agent = s.agent;
		s.agent = undefined;
		s.agentHash = undefined;
		agent?.close();
	}

	/** A path for a new transcript that no other file has. */
	private freePath(meta: TranscriptMeta) {
		const date = localDate(new Date(meta.created));
		const slug = slugify(meta.title) || meta.id.slice(0, 8);
		const dir = sessionsDir(meta.course);
		const taken = new Set(this.folder.list(dir).map((e) => e.name));
		for (let n = 1; ; n += 1) {
			const name = `${date}-${slug}${n === 1 ? "" : `-${n}`}.md`;
			if (!taken.has(name)) return `${dir}/${name}`;
		}
	}

	private emitMeta(id: string, s: LiveSession, patch: Partial<TranscriptMeta>) {
		const meta = clientMeta({ ...s.view.meta, ...patch });
		this.emit(id, s, { type: "meta", meta });
	}

	private snapshotOf(id: string, s: LiveSession): SnapshotMessage {
		return {
			t: "snapshot",
			session: id,
			epoch: this.epoch,
			seq: s.seq,
			...s.view,
		};
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

export class BadRequest extends Error {}

/** The view of a transcript: each question with the answer after it. */
export function viewOf(transcript: Transcript, id: string): SessionView {
	const view = emptyView(clientMeta({ ...transcript.meta, id }));
	const turns: Turn[] = [];
	const notes: SessionView["notes"] = [];
	for (const [i, entry] of parseBody(transcript.body).entries()) {
		const key = `${id}:${i}`;
		if (entry.kind === "user") {
			turns.push({
				id: key,
				user: {
					turnId: key,
					clientMsgId: key,
					from: "local",
					text: entry.text,
					...(entry.anchor ? { anchor: entry.anchor } : {}),
					attachments: [],
				},
				blocks: [],
				// Until an answer follows: a question the server never answered.
				end: { reason: "interrupted", usage: NO_USAGE },
			});
		} else if (entry.kind === "answer") {
			const turn = turns.at(-1);
			if (!turn || turn.blocks.length > 0) continue;
			turn.blocks = entry.text
				? [{ id: `${key}:0`, kind: "text", text: entry.text, done: true }]
				: [];
			turn.end = { reason: entry.reason, usage: NO_USAGE };
		} else {
			notes.push({
				id: key,
				anchor: entry.anchor,
				...(entry.text ? { text: entry.text } : {}),
			});
		}
	}
	return { ...view, turns, notes };
}

function clientMeta(meta: Partial<TranscriptMeta> & SessionMeta): SessionMeta {
	return {
		id: meta.id,
		course: meta.course,
		title: meta.title,
		created: meta.created,
		...(meta.mode ? { mode: meta.mode } : {}),
	};
}

/** The note a fresh agent gets ahead of its first message. */
function seedFrom(history: string) {
	return [
		"<transcript>",
		"This study session started earlier. Its conversation so far, from the session's Markdown file, is below. Continue from it; do not mention this note.",
		history,
		"</transcript>",
	].join("\n\n");
}

/** The first line of a message, as a title of at most 60 characters. */
function titleFrom(text: string) {
	const line = text
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\$+/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}

export function slugify(title: string) {
	return title
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/, "");
}

function localDate(date: Date) {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
