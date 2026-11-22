/**
 * Helpers for the integration tests: real HTTP and WebSocket against
 * FakeDriver, in a fresh study folder per test. Call `cleanUp` in `afterEach`.
 */
import { expect } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type EventMessage,
	ServerMessage,
	type SessionEvent,
	type SnapshotMessage,
} from "../shared/protocol.ts";
import { reduce } from "../shared/reducer.ts";
import { FakeDriver, type FakeDriverOptions } from "./agent/fake.ts";
import { type ServerOptions, startServer } from "./http.ts";

export type Server = Awaited<ReturnType<typeof startServer>>;
const servers: Server[] = [];
const sockets: WebSocket[] = [];
const dirs: string[] = [];

export async function cleanUp() {
	for (const ws of sockets.splice(0)) ws.close();
	for (const server of servers.splice(0)) await server.stop(true);
	for (const dir of dirs.splice(0)) await rm(dir, { recursive: true });
}

export async function studyDir() {
	const dir = await realpath(await mkdtemp(join(tmpdir(), "lemma-study-")));
	dirs.push(dir);
	return dir;
}

/**
 * Starts a server and creates one session. Pass `driver` and `studyDir` from
 * an earlier call to model a restart: same folder, same saved SDK sessions.
 */
export async function serve(
	options: FakeDriverOptions,
	reuse: { driver?: FakeDriver; studyDir?: string; create?: boolean } & Partial<
		Pick<ServerOptions, "idleMs">
	> = {},
) {
	const driver = reuse.driver ?? new FakeDriver(options);
	const dir = reuse.studyDir ?? (await studyDir());
	const server = await startServer({
		port: 0,
		distDir: null,
		driver,
		studyDir: dir,
		...(reuse.idleMs === undefined ? {} : { idleMs: reuse.idleMs }),
	});
	servers.push(server);
	const api = (path: string, body?: unknown, method?: string) =>
		fetch(new URL(path, server.url), {
			method: method ?? (body === undefined ? "GET" : "POST"),
			headers: { "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	if (reuse.create === false) return { server, api, id: "", driver, dir };
	const res = await api("/api/sessions", { course: "probabilidad" });
	expect(res.status).toBe(201);
	const { id } = (await res.json()) as { id: string };
	return { server, api, id, driver, dir };
}

/** Holds replay before message `index` of turn `turn` until `release()`. */
export function hold(index: number, turn = 0) {
	let release = () => {};
	let reached = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	const arrived = new Promise<void>((resolve) => (reached = resolve));
	return {
		pace: (i: number, t: number) => {
			if (i !== index || t !== turn) return;
			reached();
			return held;
		},
		arrived,
		release: () => release(),
	};
}

export class Client {
	readonly messages: ServerMessage[] = [];
	private waiters: (() => void)[] = [];

	private constructor(readonly ws: WebSocket) {
		ws.onmessage = (m) => {
			this.messages.push(ServerMessage.parse(JSON.parse(String(m.data))));
			for (const wake of this.waiters.splice(0)) wake();
		};
	}

	static async subscribe(server: Server, session: string) {
		const ws = new WebSocket(
			new URL("/ws", server.url.href.replace("http", "ws")),
		);
		sockets.push(ws);
		await new Promise((resolve) => (ws.onopen = resolve));
		const client = new Client(ws);
		ws.send(JSON.stringify({ t: "sub", session }));
		await client.until((m) => m.t === "snapshot");
		return client;
	}

	get snapshot() {
		return this.messages.find((m) => m.t === "snapshot") as SnapshotMessage;
	}

	get events() {
		return this.messages.filter((m): m is EventMessage => m.t === "ev");
	}

	/** Resolves once a message matches, including one already received. */
	async until(match: (m: ServerMessage) => boolean) {
		while (!this.messages.some(match)) {
			await new Promise<void>((wake) => this.waiters.push(wake));
		}
	}

	untilEvent(match: (e: SessionEvent) => boolean) {
		return this.until((m) => m.t === "ev" && match(m.e));
	}

	/** The view this client holds: its snapshot plus the events after it. */
	view() {
		const { t: _, session: __, epoch: ___, seq: ____, ...view } = this.snapshot;
		return reduce(
			view,
			this.events.map((m) => m.e),
		);
	}
}

export const turnEnds = (n: number) => (c: Client) =>
	c.until(() => c.events.filter((m) => m.e.type === "turn_end").length >= n);
