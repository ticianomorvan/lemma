import { mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import { type ZodType, z } from "zod";
import {
	ClientMessage,
	CreateSessionBody,
	type CreateSessionResponse,
	type ErrorResponse,
	type InterruptResponse,
	PatchSessionBody,
	SendMessageBody,
	type ServerMessage,
	SetFolderBody,
	type StateResponse,
} from "../shared/protocol.ts";
import type { AgentDriver } from "./agent/driver.ts";
import { expandHome } from "./config.ts";
import { Folder } from "./folder/folder.ts";
import { BadRequest, Sessions, topic } from "./sessions.ts";

export type ServerOptions = {
	port: number;
	/**
	 * Directory of the built client (`vite build`) to serve. In dev it is null:
	 * the Vite dev server serves the client and forwards `/api` and `/ws` here.
	 */
	distDir: string | null;
	driver: AgentDriver;
	/** The study folder, or null to ask for it on first run. */
	studyDir: string | null;
	/** Stores the folder the first-run screen chose. */
	saveStudyDir?: (path: string) => void;
	/** How long an agent may sit idle before it is closed. */
	idleMs?: number;
};

/** Per-socket data. Empty until auth (step 4) adds the device. */
type Socket = Record<string, never>;

const HOST = "127.0.0.1";
/** The topic every socket is subscribed to, for `folder` messages. */
const FOLDER_TOPIC = "folder";

type Study = { folder: Folder; sessions: Sessions; unwatch: () => void };

export async function startServer({
	port,
	distDir,
	driver,
	studyDir,
	saveStudyDir,
	idleMs,
}: ServerOptions) {
	const publish = (name: string, message: ServerMessage) =>
		server.publish(name, JSON.stringify(message));
	const open = (dir: string): Study => {
		const folder = new Folder(dir);
		const sessions = new Sessions({
			driver,
			folder,
			publish,
			...(idleMs === undefined ? {} : { idleMs }),
		});
		const unwatch = folder.watch((change) => {
			publish(FOLDER_TOPIC, { t: "folder", ...change });
			sessions.changed(change);
		});
		return { folder, sessions, unwatch };
	};
	let study: Study | null = studyDir ? open(studyDir) : null;
	/** Routes that need the folder answer 409 until it is set. */
	const withStudy =
		<R extends Request>(
			handle: (req: R, study: Study) => Response | Promise<Response>,
		) =>
		(req: R) =>
			study
				? handle(req, study)
				: error(409, "no_folder", "choose the study folder first");

	const server: Bun.Server<Socket> = Bun.serve({
		hostname: HOST,
		port,
		maxRequestBodySize: 1024 * 1024,
		routes: {
			...(distDir ? await clientRoutes(distDir) : {}),
			"/api/state": {
				GET: () =>
					Response.json(
						(study
							? {
									folder: study.folder.root,
									courses: study.sessions.courses(),
									sessions: study.sessions.list(),
								}
							: {
									folder: null,
									courses: [],
									sessions: [],
								}) satisfies StateResponse,
					),
			},
			"/api/folder": {
				POST: (req) =>
					withBody(req, SetFolderBody, (body) => {
						if (study) {
							return error(
								409,
								"folder_set",
								"the study folder is already set",
							);
						}
						const dir = studyFolder(body.path);
						if (typeof dir !== "string") return dir;
						study = open(dir);
						saveStudyDir?.(study.folder.root);
						return Response.json(
							{ folder: study.folder.root },
							{ status: 201 },
						);
					}),
			},
			"/api/sessions": {
				POST: withStudy((req, { sessions }) =>
					withBody(req, CreateSessionBody, (body) =>
						Response.json(
							{ id: sessions.create(body).id } satisfies CreateSessionResponse,
							{ status: 201 },
						),
					),
				),
			},
			"/api/sessions/:id": {
				GET: withStudy((req, { sessions }) =>
					found(sessions.snapshot(req.params.id)),
				),
				PATCH: withStudy((req, { sessions }) =>
					withBody(req, PatchSessionBody, (body) =>
						found(sessions.update(req.params.id, body)),
					),
				),
			},
			"/api/sessions/:id/messages": {
				POST: withStudy((req, { sessions }) =>
					withBody(req, SendMessageBody, (body) =>
						found(sessions.send(req.params.id, body), 202),
					),
				),
			},
			"/api/sessions/:id/interrupt": {
				POST: withStudy(async (req, { sessions }) => {
					const interrupted = await sessions.interrupt(req.params.id);
					return found(
						interrupted === undefined
							? undefined
							: ({ interrupted } satisfies InterruptResponse),
					);
				}),
			},
			"/api/*": () => error(404, "not_found", "no such route"),
			"/ws": (req, server) =>
				server.upgrade(req, { data: {} })
					? undefined
					: error(400, "bad_request", "expected a WebSocket upgrade"),
		},
		websocket: {
			// A socket that falls this far behind is closed; its client re-subscribes.
			backpressureLimit: 1024 * 1024,
			closeOnBackpressureLimit: true,
			open(ws) {
				ws.subscribe(FOLDER_TOPIC);
			},
			message(ws, raw) {
				const parsed = ClientMessage.safeParse(parseJson(String(raw)));
				if (!parsed.success) {
					return send(ws, {
						t: "error",
						code: "bad_request",
						message: z.prettifyError(parsed.error),
					});
				}
				const { t, session } = parsed.data;
				if (t === "unsub") return void ws.unsubscribe(topic(session));
				const snapshot = study?.sessions.snapshot(session);
				if (!snapshot) {
					return send(ws, {
						t: "error",
						session,
						code: "not_found",
						message: "no such session",
					});
				}
				// Same tick: no event can be published between these two lines.
				send(ws, snapshot);
				ws.subscribe(topic(session));
			},
		},
		fetch: () => new Response("Not found", { status: 404 }),
		error(cause) {
			if (cause instanceof BadRequest) {
				return error(400, "bad_request", cause.message);
			}
			console.error(cause);
			return error(500, "internal", String(cause));
		},
	});
	const stop = server.stop.bind(server);
	// Stopping the server also closes the watcher and the live agents.
	server.stop = (closeActiveConnections?: boolean) => {
		study?.unwatch();
		study?.sessions.close();
		return stop(closeActiveConnections);
	};
	return server;
}

/**
 * The folder a first-run path names, made if it doesn't exist, or an error
 * response. The home folder itself and `/` are refused: Claude could then read
 * everything in them.
 */
function studyFolder(input: string): string | Response {
	const path = expandHome(input.trim());
	if (!isAbsolute(path)) {
		return error(400, "bad_request", "use a full path, like ~/Estudio");
	}
	const dir = resolve(path);
	if (dir === "/" || dir === resolve(homedir())) {
		return error(400, "too_broad", "choose a folder inside your home folder");
	}
	try {
		mkdirSync(dir, { recursive: true });
		if (!statSync(dir).isDirectory()) throw new Error("not a folder");
	} catch {
		return error(400, "not_a_folder", "that path is not a folder you can use");
	}
	return dir;
}

function send(ws: Bun.ServerWebSocket<Socket>, message: ServerMessage) {
	ws.send(JSON.stringify(message));
}

async function withBody<T>(
	req: Request,
	schema: ZodType<T>,
	handle: (body: T) => Response | Promise<Response>,
) {
	// JSON only: a cross-site form or no-cors fetch can't send this type
	// without a CORS preflight, which this server never answers.
	if (!req.headers.get("content-type")?.startsWith("application/json")) {
		return error(415, "unsupported_media_type", "send application/json");
	}
	const parsed = schema.safeParse(parseJson(await req.text()));
	if (!parsed.success) {
		return error(400, "bad_request", z.prettifyError(parsed.error));
	}
	return handle(parsed.data);
}

function found(value: object | undefined, status = 200) {
	return value === undefined
		? error(404, "not_found", "no such session")
		: Response.json(value, { status });
}

function error(status: number, code: string, message: string) {
	return Response.json({ error: { code, message } } satisfies ErrorResponse, {
		status,
	});
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * One route per file in the build output. Other paths without an extension get
 * the SPA shell; a missing asset (say, a stale hashed bundle) gets a 404, not HTML.
 */
async function clientRoutes(distDir: string) {
	const root = resolve(distDir);
	const index = Bun.file(join(root, "index.html"));
	if (!(await index.exists())) {
		throw new Error(
			`${root}/index.html not found; run \`bun run build\` first`,
		);
	}
	const routes: Record<string, Response | ((req: Request) => Response)> = {};
	for await (const path of new Bun.Glob("**/*").scan(root)) {
		routes[`/${path}`] = new Response(Bun.file(join(root, path)));
	}
	routes["/*"] = (req) =>
		extname(new URL(req.url).pathname)
			? new Response("Not found", { status: 404 })
			: new Response(index);
	return routes;
}
