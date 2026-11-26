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
import { basename } from "node:path";
import type {
	Attachment,
	Block,
	CreateSessionBody,
	Mode,
	Note,
	NoteBody,
	NoteResponse,
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
	UserMessage,
} from "../shared/protocol.ts";
import { apply, emptyView } from "../shared/reducer.ts";
import type { AgentDriver, AgentImage, AgentSession } from "./agent/driver.ts";
import type { Folder, FolderChange } from "./folder/folder.ts";
import {
	attachmentsDir,
	isCourse,
	isCourseName,
	sessionsDir,
} from "./folder/layout.ts";
import {
	type KnownMode,
	listModes,
	modeMessage,
	readSkill,
	UNKNOWN,
} from "./modes/modes.ts";
import { type PhotoType, photoName, photoType } from "./photos.ts";
import {
	appendEntry,
	bodyHash,
	format,
	oneLine,
	type Part,
	parseBody,
	partsOf,
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
	/**
	 * The mode the live agent was told about (`modeMessage`). A message after
	 * a change carries the new one.
	 */
	agentMode: KnownMode;
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

	/** The study modes in the folder's `.claude/skills/`. */
	modes(): Mode[] {
		return listModes(this.folder);
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
		if (mode !== undefined) this.checkMode(mode);
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

	/**
	 * Queues a message from device `from`; it is answered after every message
	 * that arrived before it.
	 */
	send(
		id: string,
		body: SendMessageBody,
		from: string,
	): SendMessageResponse | undefined {
		const s = this.load(id);
		if (!s) return undefined;
		const turnId = crypto.randomUUID();
		const queued = s.view.status === "running" || s.view.queue.length > 0;
		// Only photos still waiting: another message may have taken one already.
		const wanted = new Set(body.attachmentIds ?? []);
		const attachments = s.view.attachments.filter((a) => wanted.has(a.id));
		if (!body.text.trim() && attachments.length === 0) {
			throw new BadRequest("those photos were already sent");
		}
		// The question itself is written when its turn starts, so each answer
		// follows its own question in the file even when messages queue up.
		const title = titleFrom(body.text) || (attachments.length ? "Foto" : "");
		if (!s.view.meta.title && title) this.update(id, { title });
		this.emit(id, s, {
			type: "user_message",
			turnId,
			clientMsgId: body.clientMsgId,
			from,
			text: body.text,
			...(body.anchor === undefined ? {} : { anchor: body.anchor }),
			attachments,
			queued,
		});
		this.next(id, s);
		return { turnId, queued };
	}

	/**
	 * Appends a note (a highlight, with or without text) to the transcript. It
	 * starts no turn. A note never makes the agent start over: hashes that
	 * matched the file before it (the live agent's and the front matter's)
	 * are moved past it, and the next message carries every note after the
	 * last question (see `next`).
	 */
	note(id: string, body: NoteBody): NoteResponse | undefined {
		const s = this.load(id);
		if (!s) return undefined;
		const anchor = { ...body.anchor, text: body.anchor.text.trim() };
		const text = body.text?.trim();
		const note: Note = {
			id: crypto.randomUUID(),
			anchor,
			...(text ? { text } : {}),
		};
		const before = read(this.folder, s.path);
		const after = appendEntry(before, { kind: "note", ...note });
		const was = bodyHash(before.body);
		const now = bodyHash(after.body);
		if (after.meta.sdk_body_hash === was) {
			after.meta = { ...after.meta, sdk_body_hash: now };
		}
		write(this.folder, s.path, after);
		if (s.agent && s.agentHash === was) s.agentHash = now;
		this.emit(id, s, { type: "note", ...note });
		return { id: note.id };
	}

	/**
	 * Saves a photo in the session's attachments folder (next to its `.md`).
	 * It waits in the view, on every client, until a message takes it.
	 */
	attach(
		id: string,
		bytes: Uint8Array,
		type: PhotoType,
	): Attachment | undefined {
		const s = this.load(id);
		if (!s) return undefined;
		const path = this.folder.saveAttachment(
			attachmentsDir(s.path),
			bytes,
			photoName(type),
		);
		const attachment = { id: basename(path), path };
		this.emit(id, s, {
			type: "attachments",
			pending: [...s.view.attachments, attachment],
		});
		return attachment;
	}

	/** Drops a waiting photo and deletes its file. False if it isn't waiting. */
	detach(id: string, attachmentId: string): boolean | undefined {
		const s = this.load(id);
		if (!s) return undefined;
		const found = s.view.attachments.find((a) => a.id === attachmentId);
		if (!found) return false;
		this.folder.remove(found.path);
		this.emit(id, s, {
			type: "attachments",
			pending: s.view.attachments.filter((a) => a !== found),
		});
		return true;
	}

	/** Changes the title or mode in the front matter. */
	update(id: string, body: PatchSessionBody): SessionMeta | undefined {
		const s = this.load(id);
		if (!s) return undefined;
		const patch: Partial<TranscriptMeta> = {};
		if (body.title !== undefined) patch.title = body.title.trim();
		if (body.mode !== undefined) {
			if (body.mode !== null) this.checkMode(body.mode);
			patch.mode = body.mode ?? undefined;
		}
		const current = read(this.folder, s.path);
		write(this.folder, s.path, {
			meta: { ...current.meta, ...patch },
			body: current.body,
		});
		this.emitMeta(id, s, patch);
		return s.view.meta;
	}

	private checkMode(mode: string) {
		if (!readSkill(this.folder, mode)) {
			throw new BadRequest(`no mode ${mode} in .claude/skills/`);
		}
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
				s.view = this.viewAt(path, id);
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
			view = this.viewAt(path, id);
		} catch {
			return undefined;
		}
		const s: LiveSession = { path, view, seq: 0, agentMode: UNKNOWN };
		this.live.set(id, s);
		return s;
	}

	/** A session's view from its file, with the photos waiting in its folder. */
	private viewAt(path: string, id: string): SessionView {
		const view = viewOf(read(this.folder, path), id);
		return { ...view, attachments: this.waiting(path, view) };
	}

	/**
	 * The photos in a session's attachments folder that no question links yet:
	 * uploaded, not sent. The folder keeps them across a restart.
	 */
	private waiting(path: string, view: SessionView): Attachment[] {
		const sent = new Set(
			view.turns.flatMap((t) => t.user.attachments.map((a) => a.path)),
		);
		const dir = attachmentsDir(path);
		return this.folder
			.list(dir)
			.filter(
				(e) => !e.dir && photoType(e.name) && !sent.has(`${dir}/${e.name}`),
			)
			.map((e) => ({ id: e.name, path: `${dir}/${e.name}` }));
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
		let notes: Note[];
		let images: AgentImage[];
		let photos: Attachment[];
		try {
			const before = read(this.folder, s.path);
			const hash = bodyHash(before.body);
			if (s.agent && hash !== s.agentHash) this.stop(s);
			const { sdk_session_id, sdk_body_hash } = before.meta;
			const history = before.body.trim();
			notes = notesSinceLastQuestion(before.body);
			start = {
				...(sdk_session_id && sdk_body_hash === hash
					? { resumeId: sdk_session_id }
					: {}),
				...(history ? { seed: seedFrom(history) } : {}),
			};
			({ photos, images } = this.images(user.attachments));
			const after = appendEntry(before, {
				kind: "user",
				text: user.text,
				...(user.anchor === undefined ? {} : { anchor: user.anchor }),
				...(user.attachments.length > 0
					? { attachments: user.attachments.map((a) => a.path) }
					: {}),
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
			const fresh = !agent;
			try {
				if (!agent) {
					agent = await this.driver.start({ folder: this.folder, ...start });
					if (!current()) return agent.close();
					s.agent = agent;
					s.agentHash = asked;
					s.agentMode = agent.resumed ? UNKNOWN : null;
					void this.run(id, s, agent);
				}
				// The mode is read as this message goes, so a change made during
				// the previous turn applies to this one.
				const steer = modeMessage(this.folder, s.view.meta.mode, s.agentMode);
				s.agentMode = steer.known;
				// An agent seeded with the file has its notes already.
				agent.push(
					agentMessage(
						{ ...user, attachments: photos },
						fresh && !agent.resumed ? [] : notes,
						steer.note,
					),
					images,
				);
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

	/**
	 * The photos' bytes for Claude. One deleted meanwhile is left out, of the
	 * images and of the paths Claude is told about.
	 */
	private images(attachments: Attachment[]) {
		const photos: Attachment[] = [];
		const images: AgentImage[] = [];
		for (const a of attachments) {
			const type = photoType(a.path);
			if (!type) continue;
			try {
				const data = this.folder.readBytes(a.path).toString("base64");
				images.push({ mediaType: type, data });
				photos.push(a);
			} catch {}
		}
		return { photos, images };
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
		const parts = partsOf(turn.blocks);
		try {
			const before = read(this.folder, s.path);
			const after = appendEntry(before, { kind: "answer", parts, reason });
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
		s.agentMode = UNKNOWN;
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
					attachments: (entry.attachments ?? []).map((path) => ({
						id: basename(path),
						path,
					})),
				},
				blocks: [],
				// Until an answer follows: a question the server never answered.
				end: { reason: "interrupted", usage: NO_USAGE },
			});
		} else if (entry.kind === "answer") {
			const turn = turns.at(-1);
			if (!turn || turn.blocks.length > 0) continue;
			turn.blocks = entry.parts.map((part, j) => blockOf(part, `${key}:${j}`));
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

/** A transcript's answer part as the thread's block. */
function blockOf(part: Part, id: string): Block {
	switch (part.kind) {
		case "text":
		case "thinking":
			return { id, kind: part.kind, text: part.text, done: true };
		case "tool":
			return {
				id,
				kind: "tool",
				name: part.name,
				text: part.input,
				done: true,
				...(part.result ? { result: part.result } : {}),
			};
	}
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

/**
 * What Claude gets for a question: the study mode when it changed, the
 * notes added since its last message,
 * the passage it quotes (with the file and page, so Claude can `Read` it),
 * then the question.
 */
export function agentMessage(
	user: Pick<UserMessage, "text" | "anchor"> &
		Partial<Pick<UserMessage, "attachments">>,
	notes: Note[] = [],
	/** The `<mode>` note (`modeMessage`), when the mode changed. */
	mode: string | null = null,
) {
	const parts: string[] = mode ? [mode] : [];
	const photos = user.attachments ?? [];
	if (photos.length > 0) {
		parts.push(
			[
				"<photos>",
				`The student took ${photos.length === 1 ? "this photo" : `these ${photos.length} photos`} with their phone, usually of handwritten work. They are attached above and saved in the study folder at:`,
				...photos.map((a) => `- ${attr(a.path)}`),
				"</photos>",
			].join("\n"),
		);
	}
	if (notes.length > 0) {
		parts.push(
			[
				"<notes>",
				"The student added these notes to the session since your last answer:",
				...notes.map(
					(n) =>
						`- On ${attr(n.anchor.path)}, page ${n.anchor.page}, they marked "${oneLine(n.anchor.text)}"${n.text ? `: ${n.text}` : "."}`,
				),
				"</notes>",
			].join("\n"),
		);
	}
	if (user.anchor) {
		const { path, page, text } = user.anchor;
		parts.push(
			[
				`<passage path="${attr(path)}" page="${page}">`,
				"The student selected this passage on the page they are reading and asks about it:",
				// The quote is the PDF's text: it may not close the tag.
				text.trim().replace(/<(\/?passage)/gi, "&lt;$1"),
				"</passage>",
			].join("\n"),
		);
	}
	if (user.text.trim()) parts.push(user.text);
	return parts.join("\n\n");
}

const attr = (value: string) =>
	value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * The notes after the transcript's last question: the ones Claude hasn't
 * been sent. (A note written during a turn goes with the next message.)
 */
function notesSinceLastQuestion(body: string): Note[] {
	const entries = parseBody(body);
	const last = entries.findLastIndex((e) => e.kind === "user");
	return entries.slice(last + 1).flatMap((e, i) =>
		e.kind === "note"
			? [
					{
						id: String(i),
						anchor: e.anchor,
						...(e.text ? { text: e.text } : {}),
					},
				]
			: [],
	);
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
