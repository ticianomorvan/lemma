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
import { Auth } from "./auth/auth.ts";
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

/** The cookie each test server's paired client sends. */
const cookies = new WeakMap<Server, string>();
const auths = new WeakMap<Server, Auth>();

/** The `Auth` a test server was started with. */
export const authOf = (server: Server) => auths.get(server) as Auth;

/**
 * Starts a server with its own config folder and pairs one client through
 * `/pair/<code>`, like a browser would. `api` sends that client's cookie and
 * Origin; pass `headers` to override them (`cookie: ""` sends none).
 */
export async function start({
	configDir,
	devOrigin,
	...options
}: Omit<ServerOptions, "auth"> & { configDir?: string; devOrigin?: string }) {
	const auth = new Auth({
		dir: configDir ?? (await studyDir()),
		...(devOrigin ? { devOrigin } : {}),
	});
	const server = await startServer({ ...options, auth });
	servers.push(server);
	auths.set(server, auth);
	const cookie = await pair(server);
	cookies.set(server, cookie);
	const api = (
		path: string,
		body?: unknown,
		method?: string,
		headers: Record<string, string> = {},
	) =>
		fetch(new URL(path, server.url), {
			method: method ?? (body === undefined ? "GET" : "POST"),
			headers: {
				"content-type": "application/json",
				origin: server.url.origin,
				cookie,
				...headers,
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	return { server, api, cookie };
}

/**
 * What a pairing page does with its link: a same-origin POST to it (opening
 * it only loads the page).
 */
export const redeem = (
	url: string | URL,
	headers: Record<string, string> = {},
) =>
	fetch(url, {
		method: "POST",
		headers: { origin: new URL(url).origin, ...headers },
	});

/** Redeems a fresh pairing code and returns the `name=token` cookie it set. */
export async function pair(
	server: Server,
	headers: Record<string, string> = {},
) {
	// Straight to this server, even when the link names the dev server.
	const { pathname } = new URL(authOf(server).startPairing().url);
	const res = await redeem(new URL(pathname, server.url), headers);
	expect(res.status).toBe(200);
	const set = res.headers.get("set-cookie") ?? "";
	return set.split(";")[0] as string;
}

/**
 * Starts a server and creates one session. Pass `driver` and `studyDir` from
 * an earlier call to model a restart: same folder, same saved SDK sessions.
 */
export async function serve(
	options: FakeDriverOptions,
	reuse: { driver?: FakeDriver; studyDir?: string; create?: boolean } & Partial<
		Pick<ServerOptions, "idleMs" | "lanAddress">
	> = {},
) {
	const driver = reuse.driver ?? new FakeDriver(options);
	const dir = reuse.studyDir ?? (await studyDir());
	const { server, api, cookie } = await start({
		port: 0,
		distDir: null,
		driver,
		studyDir: dir,
		...(reuse.idleMs === undefined ? {} : { idleMs: reuse.idleMs }),
		...(reuse.lanAddress ? { lanAddress: reuse.lanAddress } : {}),
	});
	if (reuse.create === false)
		return { server, api, cookie, id: "", driver, dir };
	const res = await api("/api/sessions", { course: "probabilidad" });
	expect(res.status).toBe(201);
	const { id } = (await res.json()) as { id: string };
	return { server, api, cookie, id, driver, dir };
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

/**
 * A WebSocket to `/ws` with these headers. Bun's client takes `headers`;
 * the DOM types, which win in this tsconfig, don't know it.
 */
export function socket(server: Server | URL, headers: Record<string, string>) {
	const BunSocket = WebSocket as unknown as new (
		url: URL,
		options: Bun.WebSocketOptions,
	) => WebSocket;
	const url = server instanceof URL ? server : server.url;
	return new BunSocket(new URL("/ws", url.href.replace("http", "ws")), {
		headers,
	});
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

	/** As the server's paired client, or `as` another (a phone on the LAN). */
	static async subscribe(
		server: Server,
		session: string,
		as?: { origin: string; cookie: string },
	) {
		const ws = as
			? socket(new URL(as.origin), { cookie: as.cookie, origin: as.origin })
			: socket(server, {
					cookie: cookies.get(server) ?? "",
					origin: server.url.origin,
				});
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
