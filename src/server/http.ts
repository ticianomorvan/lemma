import { extname, join, resolve } from "node:path";
import { type ZodType, z } from "zod";
import {
	ClientMessage,
	CreateSessionBody,
	type CreateSessionResponse,
	type Device,
	type DevicesResponse,
	type ErrorResponse,
	type InterruptResponse,
	type PairResponse,
	PatchSessionBody,
	SendMessageBody,
	type ServerMessage,
	SetFolderBody,
	type StateResponse,
} from "../shared/protocol.ts";
import type { AgentDriver } from "./agent/driver.ts";
import type { Auth } from "./auth/auth.ts";
import { chooseStudyFolder } from "./config.ts";
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
	/** Who may talk to the server; the server tells it the port it bound. */
	auth: Auth;
	/**
	 * Called when the last paired device is revoked: nobody can ask for a
	 * pairing link any more, so the caller prints a new one.
	 */
	onNoDevices?: () => void;
};

/** Per-socket data: the device the socket was opened by. */
type Socket = { device: string };

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
	auth,
	onNoDevices,
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
	let study: Study | null = null;
	if (studyDir) {
		try {
			study = open(studyDir);
		} catch (cause) {
			// Moved, deleted or on a drive that isn't mounted: ask again.
			console.error(`cannot open the study folder ${studyDir}:`, cause);
		}
	}
	/** Open sockets by device, so revoking a device closes them. */
	const sockets = new Map<string, Set<Bun.ServerWebSocket<Socket>>>();

	// Every request passes the Host/Origin screen. Only the client's own files
	// (which hold no data) and `/pair/:code` skip the device check.
	const refused = (req: Request) => {
		const why = auth.refuse(req);
		return why && error(403, why, REFUSALS[why]);
	};
	const trusted =
		<R extends Request>(handle: (req: R) => Response | Promise<Response>) =>
		(req: R) =>
			refused(req) ?? handle(req);
	const paired =
		<R extends Request, A extends unknown[]>(
			handle: (
				req: R,
				device: Device,
				...rest: A
			) => Response | undefined | Promise<Response>,
		) =>
		(req: R, ...rest: A) => {
			const denied = refused(req);
			if (denied) return denied;
			const device = auth.check(req);
			return device ? handle(req, device, ...rest) : unpaired();
		};
	/** Routes that need the folder answer 409 until it is set. */
	const withStudy = <R extends Request>(
		handle: (
			req: R,
			study: Study,
			device: Device,
		) => Response | Promise<Response>,
	) =>
		paired((req: R, device) =>
			study
				? handle(req, study, device)
				: error(409, "no_folder", "choose the study folder first"),
		);
	const client = distDir ? await clientRoutes(distDir, trusted) : null;

	const server: Bun.Server<Socket> = Bun.serve({
		hostname: HOST,
		port,
		maxRequestBodySize: 1024 * 1024,
		routes: {
			...client?.routes,
			"/pair/:code": {
				GET: trusted((req) => {
					const redeemed = auth.redeem(req.params.code, req);
					if (!redeemed) {
						// The client shows "this link no longer works" at this path.
						return client
							? new Response(client.index, {
									status: 403,
									headers: { "cache-control": "no-store" },
								})
							: error(403, "bad_code", "this pairing link was used or expired");
					}
					return new Response(null, {
						status: 303,
						headers: {
							location: "/",
							"cache-control": "no-store",
							...(redeemed.cookie ? { "set-cookie": redeemed.cookie } : {}),
						},
					});
				}),
			},
			"/api/pair": {
				POST: paired(() =>
					Response.json(auth.startPairing() satisfies PairResponse, {
						status: 201,
					}),
				),
			},
			"/api/devices": {
				GET: paired((_, device) =>
					Response.json({
						devices: auth.list(),
						current: device.id,
					} satisfies DevicesResponse),
				),
			},
			"/api/devices/:id": {
				DELETE: paired((req) => {
					const { id } = req.params;
					if (!auth.revoke(id)) {
						return error(404, "not_found", "no such device");
					}
					for (const ws of sockets.get(id) ?? []) ws.close(1008, "revoked");
					sockets.delete(id);
					if (auth.list().length === 0) onNoDevices?.();
					return new Response(null, { status: 204 });
				}),
			},
			"/api/state": {
				GET: paired(() =>
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
				),
			},
			"/api/folder": {
				POST: paired((req) =>
					withBody(req, SetFolderBody, (body) => {
						if (study) {
							return error(
								409,
								"folder_set",
								"the study folder is already set",
							);
						}
						const chosen = chooseStudyFolder(body.path);
						if ("code" in chosen) {
							return error(400, chosen.code, chosen.message);
						}
						const opened = open(chosen.dir);
						try {
							saveStudyDir?.(opened.folder.root);
						} catch (cause) {
							opened.unwatch();
							throw cause;
						}
						study = opened;
						return Response.json(
							{ folder: study.folder.root },
							{ status: 201 },
						);
					}),
				),
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
				POST: withStudy((req, { sessions }, device) =>
					withBody(req, SendMessageBody, (body) =>
						found(sessions.send(req.params.id, body, device.id), 202),
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
			"/api/*": paired(() => error(404, "not_found", "no such route")),
			"/ws": paired((req, device, server: Bun.Server<Socket>) =>
				server.upgrade(req, { data: { device: device.id } })
					? undefined
					: error(400, "bad_request", "expected a WebSocket upgrade"),
			),
		},
		websocket: {
			// A socket that falls this far behind is closed; its client re-subscribes.
			backpressureLimit: 1024 * 1024,
			closeOnBackpressureLimit: true,
			open(ws) {
				const own = sockets.get(ws.data.device) ?? new Set();
				sockets.set(ws.data.device, own.add(ws));
				ws.subscribe(FOLDER_TOPIC);
			},
			close(ws) {
				const own = sockets.get(ws.data.device);
				own?.delete(ws);
				if (own?.size === 0) sockets.delete(ws.data.device);
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
		fetch: (req) => refused(req) ?? new Response("Not found", { status: 404 }),
		error(cause) {
			if (cause instanceof BadRequest) {
				return error(400, "bad_request", cause.message);
			}
			console.error(cause);
			return error(500, "internal", String(cause));
		},
	});
	auth.listen(server.port as number);
	const stop = server.stop.bind(server);
	// Stopping the server also closes the watcher and the live agents.
	server.stop = (closeActiveConnections?: boolean) => {
		study?.unwatch();
		study?.sessions.close();
		return stop(closeActiveConnections);
	};
	return server;
}

const REFUSALS = {
	bad_host: "this server only answers to 127.0.0.1 and localhost",
	bad_origin: "requests from other sites are refused",
} as const;

const unpaired = () =>
	error(
		403,
		"unpaired",
		"this browser is not paired: open the link Lemma prints at startup",
	);

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

type Route = (req: Request) => Response | Promise<Response>;

/**
 * One route per file in the build output. Other paths without an extension get
 * the SPA shell; a missing asset (say, a stale hashed bundle) gets a 404, not HTML.
 */
async function clientRoutes(
	distDir: string,
	wrap: (handle: (req: Request) => Response) => Route,
) {
	const root = resolve(distDir);
	const index = Bun.file(join(root, "index.html"));
	if (!(await index.exists())) {
		throw new Error(
			`${root}/index.html not found; run \`bun run build\` first`,
		);
	}
	const routes: Record<string, Route> = {};
	for await (const path of new Bun.Glob("**/*").scan(root)) {
		const file = Bun.file(join(root, path));
		// Vite puts content hashes in every name under assets/.
		const headers: HeadersInit = path.startsWith("assets/")
			? { "cache-control": "public, max-age=31536000, immutable" }
			: {};
		routes[`/${path}`] = wrap(() => new Response(file, { headers }));
	}
	routes["/*"] = wrap((req) =>
		extname(new URL(req.url).pathname)
			? new Response("Not found", { status: 404 })
			: new Response(index),
	);
	return { routes, index };
}
