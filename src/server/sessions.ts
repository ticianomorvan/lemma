/**
 * Sessions, each one a Markdown transcript at `<course>/sessions/<date>-<slug>.md`
 * (see docs/architecture.md → Sessions and the source of truth). A session is
 * loaded from its file when first used, then queues messages in arrival order,
 * runs one agent turn at a time, and publishes every event to the topic
 * `s:<id>` with a gapless `seq`.
 *
 * - The transcript gets the user message when it is accepted and the answer
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
import {
	appendEntry,
	bodyHash,
	type Entry,
	format,
	formatEntry,
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
	/** `bodyHash` of the body as we last read or wrote it. */
	known: string;
	/** The file changed under us since: the next agent starts fresh. */
	edited: boolean;
	/** The SDK session to try to resume when the next agent starts. */
	resumable?: string;
	agent?: AgentSession;
	/** The SDK session the live agent runs in. */
	sdkSessionId?: string;
	/** An interrupt the agent hasn't acknowledged yet. */
	interrupting?: Promise<void>;
	idle?: ReturnType<typeof setTimeout>;
};

const NO_USAGE = { inputTokens: 0, outputTokens: 0 };
const IDLE_MS = 10 * 60 * 1000;
/** Top-level folders that are not courses. */
const NOT_COURSES = new Set(["inbox"]);

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
			.filter((e) => e.dir && !NOT_COURSES.has(e.name))
			.map((e) => e.name);
	}

	/** Every session in the folder, oldest first, read from the front matter. */
	list(): SessionSummary[] {
		const sessions: SessionSummary[] = [];
		this.paths.clear();
		for (const course of this.courses()) {
			for (const file of this.folder.list(`${course}/sessions`)) {
				if (file.dir || !file.name.endsWith(".md")) continue;
				const path = `${course}/sessions/${file.name}`;
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
		const meta = s.view.meta.title ? {} : { title: titleFrom(body.text) };
		this.record(
			s,
			{
				kind: "user",
				text: body.text,
				...(body.anchor === undefined ? {} : { anchor: body.anchor }),
			},
			meta,
		);
		if (meta.title) this.emitMeta(id, s, meta);
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
		const current = this.current(s);
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
		if (!s.view.inflight || !s.agent) return false;
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
	 * reloads from disk and pushes the new snapshot to its clients.
	 */
	changed({ path }: FolderChange) {
		for (const [id, s] of this.live) {
			if (s.path !== path || s.view.inflight || s.view.queue.length > 0) {
				continue;
			}
			let transcript: Transcript;
			try {
				transcript = read(this.folder, path);
			} catch {
				continue;
			}
			const hash = bodyHash(transcript.body);
			if (hash === s.known) continue;
			s.edited = true;
			s.known = hash;
			s.view = viewOf(transcript, s.view.meta.id);
			s.seq += 1;
			this.publish(topic(id), this.snapshotOf(id, s));
		}
	}

	close() {
		for (const s of this.live.values()) {
			clearTimeout(s.idle);
			s.agent?.close();
		}
		this.live.clear();
	}

	private load(id: string): LiveSession | undefined {
		const loaded = this.live.get(id);
		if (loaded) return loaded;
		if (!this.paths.has(id)) this.list();
		const path = this.paths.get(id);
		if (!path) return undefined;
		let transcript: Transcript;
		try {
			transcript = read(this.folder, path);
		} catch {
			return undefined;
		}
		const { meta, body } = transcript;
		const known = bodyHash(body);
		const s: LiveSession = {
			path,
			view: viewOf(transcript, id),
			seq: 0,
			known,
			edited: false,
			...(meta.sdk_session_id && meta.sdk_body_hash === known
				? { resumable: meta.sdk_session_id }
				: {}),
		};
		this.live.set(id, s);
		return s;
	}

	/** The file now, noting whether it changed since we last saw it. */
	private current(s: LiveSession): Transcript {
		const transcript = read(this.folder, s.path);
		if (bodyHash(transcript.body) !== s.known) s.edited = true;
		return transcript;
	}

	/** Appends an entry to the transcript as it is on disk now. */
	private record(
		s: LiveSession,
		entry: Entry,
		meta:
			| Partial<TranscriptMeta>
			| ((next: Transcript) => Partial<TranscriptMeta>) = {},
	) {
		const next = appendEntry(this.current(s), entry);
		const patch = typeof meta === "function" ? meta(next) : meta;
		write(this.folder, s.path, { ...next, meta: { ...next.meta, ...patch } });
		s.known = bodyHash(next.body);
	}

	/** Starts the next queued turn if the agent is free. */
	private next(id: string, s: LiveSession) {
		const user = s.view.queue[0];
		if (s.view.inflight || !user) return;
		clearTimeout(s.idle);
		this.emit(id, s, { type: "turn_start", turnId: user.turnId });
		const current = () =>
			this.live.get(id) === s && s.view.inflight?.id === user.turnId;
		const push = async () => {
			if (!current()) return;
			let agent = s.agent;
			try {
				if (agent && s.edited) {
					// The transcript changed under the live agent: start over from it.
					this.stop(s);
					agent = undefined;
				}
				if (!agent) {
					agent = await this.startAgent(s);
					if (!current()) return agent.close();
					s.agent = agent;
					void this.run(id, s, agent);
				}
				agent.push(user.text);
			} catch (error) {
				if (agent && s.agent === agent) this.fail(id, s, agent, String(error));
				else this.endWithError(id, s, String(error));
			}
		};
		if (s.interrupting) void s.interrupting.then(push);
		else void push();
	}

	/** Resumes the saved SDK session when it is safe to, else starts seeded. */
	private async startAgent(s: LiveSession): Promise<AgentSession> {
		const candidate = s.edited ? undefined : s.resumable;
		s.edited = false;
		const resume =
			candidate !== undefined &&
			(await this.driver.canResume(candidate, this.folder).catch(() => false));
		const sdkSessionId = resume ? candidate : crypto.randomUUID();
		const seed = resume ? undefined : this.seed(s);
		const agent = this.driver.start({
			folder: this.folder,
			sdkSessionId,
			resume,
			...(seed ? { seed } : {}),
		});
		s.sdkSessionId = sdkSessionId;
		s.resumable = sdkSessionId;
		return agent;
	}

	/**
	 * The transcript so far, for a fresh agent, without the messages still
	 * waiting for an answer (they arrive as the turns' own messages).
	 */
	private seed(s: LiveSession): string | undefined {
		const entries = parseBody(read(this.folder, s.path).body);
		const pending = [s.view.inflight?.user, ...s.view.queue].filter(
			(m) => m !== undefined,
		);
		for (const message of pending.reverse()) {
			const last = entries.at(-1);
			if (last?.kind === "user" && last.text === message.text.trim()) {
				entries.pop();
			}
		}
		if (entries.length === 0) return undefined;
		const history = entries.map(formatEntry).join("");
		return [
			"<transcript>",
			"This study session started earlier. Its conversation so far, from the session's Markdown file, is below. Continue from it; do not mention this note.",
			history.trim(),
			"</transcript>",
		].join("\n\n");
	}

	/** Publishes the agent's events until it closes or fails. */
	private async run(id: string, s: LiveSession, agent: AgentSession) {
		try {
			for await (const event of agent.events) {
				if (this.live.get(id) !== s || s.agent !== agent) return;
				if (event.type === "turn_end") {
					const turn = s.view.inflight;
					if (!turn) continue;
					this.finish(s, turn, event.reason, true);
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
	 * Appends a turn's answer. When the agent is alive and the file wasn't
	 * edited, the front matter records the SDK session and the new body hash,
	 * which is what lets the next start resume.
	 */
	private finish(
		s: LiveSession,
		turn: Turn,
		reason: TurnEndReason,
		alive: boolean,
	) {
		const text = turn.blocks
			.filter((b) => b.kind === "text")
			.map((b) => b.text.trim())
			.filter(Boolean)
			.join("\n\n");
		try {
			this.record(s, { kind: "answer", text, reason }, (next) =>
				alive && !s.edited && s.sdkSessionId
					? {
							sdk_session_id: s.sdkSessionId,
							sdk_body_hash: bodyHash(next.body),
						}
					: {},
			);
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
		// It may have died before saving its last turn: don't resume it.
		s.resumable = undefined;
		this.endWithError(id, s, message);
	}

	private endWithError(id: string, s: LiveSession, message: string) {
		const turn = s.view.inflight;
		if (!turn) return;
		this.finish(s, turn, "error", false);
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
		s.sdkSessionId = undefined;
		agent?.close();
	}

	/** A path for a new transcript that no other file has. */
	private freePath(meta: TranscriptMeta) {
		const date = localDate(new Date(meta.created));
		const slug = slugify(meta.title) || meta.id.slice(0, 8);
		const dir = `${meta.course}/sessions`;
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

/** A single folder name that is not hidden and not reserved. */
export function isCourseName(name: string) {
	return (
		name.trim() === name &&
		name.length > 0 &&
		!/[/\\:]/.test(name) &&
		!name.startsWith(".") &&
		!NOT_COURSES.has(name.toLowerCase())
	);
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
