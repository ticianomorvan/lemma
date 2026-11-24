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
	type MaterialsResponse,
	NoteBody,
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
import { isCourseName, materialsDir } from "./folder/layout.ts";
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
									headers: {
										"cache-control": "no-store",
										"content-security-policy": CSP,
									},
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
			"/api/sessions/:id/notes": {
				POST: withStudy((req, { sessions }) =>
					withBody(req, NoteBody, (body) =>
						found(sessions.note(req.params.id, body), 201),
					),
				),
			},
			"/api/courses/:course/materials": {
				GET: withStudy((req, { folder }) =>
					Response.json({
						files: materials(folder, req.params.course),
					} satisfies MaterialsResponse),
				),
			},
			"/files/*": {
				GET: withStudy((req, { folder }) => serveFile(req, folder)),
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

// ── Study files ─────────────────────────────────────────────────────────────

/** The PDFs under `<course>/materials/`, a few folders deep, by path. */
function materials(folder: Folder, course: string) {
	if (!isCourseName(course)) return [];
	const files: MaterialsResponse["files"] = [];
	const walk = (dir: string, depth: number) => {
		let entries: ReturnType<Folder["list"]>;
		try {
			entries = folder.list(dir);
		} catch {
			// A link out of the folder, or not a folder.
			return;
		}
		for (const e of entries) {
			const path = `${dir}/${e.name}`;
			if (e.dir) {
				if (depth < 3) walk(path, depth + 1);
			} else if (/\.pdf$/i.test(e.name) && folder.resolve(path)) {
				files.push({ path, name: e.name });
			}
		}
	};
	walk(materialsDir(course), 0);
	return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** What `/files/*` sends as which type. Anything else is a download. */
const FILE_TYPES: Record<string, string> = {
	".pdf": "application/pdf",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".md": "text/markdown; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
};

/**
 * A file in the study folder, with byte ranges for pdf.js. The path goes
 * through the folder's jail; hidden names, folders and anything outside the
 * root are a 404. Files are never run as a page of this origin: the type comes
 * from an allow-list, `nosniff` keeps it, and the CSP sandboxes any
 * navigation to one.
 */
async function serveFile(req: Request, folder: Folder) {
	const notFound = () => error(404, "not_found", "no such file");
	let path: string;
	try {
		path = new URL(req.url).pathname
			.slice("/files/".length)
			.split("/")
			.map(decodeURIComponent)
			.join("/");
	} catch {
		return notFound();
	}
	const hidden = (p: string) =>
		p.split("/").some((x) => x === "" || x.startsWith("."));
	if (hidden(path) || /[\\\0]/.test(path)) return notFound();
	const real = folder.resolve(path);
	// A link inside the folder that points into a hidden one is refused too.
	if (!real || hidden(folder.relative(real))) return notFound();
	const file = Bun.file(real);
	let size: number;
	try {
		const stat = await file.stat();
		if (!stat.isFile()) return notFound();
		size = stat.size;
	} catch {
		return notFound();
	}
	const type = FILE_TYPES[extname(real).toLowerCase()];
	const headers: Record<string, string> = {
		"accept-ranges": "bytes",
		"content-type": type ?? "application/octet-stream",
		"x-content-type-options": "nosniff",
		"content-security-policy": "sandbox; default-src 'none'",
		"cache-control": "no-cache",
		...(type ? {} : { "content-disposition": "attachment" }),
	};
	const range = req.headers.get("range");
	if (!range) {
		return new Response(file, {
			headers: { ...headers, "content-length": String(size) },
		});
	}
	const bytes = parseRange(range, size);
	if (!bytes) {
		return new Response(null, {
			status: 416,
			headers: { ...headers, "content-range": `bytes */${size}` },
		});
	}
	const [start, end] = bytes;
	return new Response(file.slice(start, end + 1), {
		status: 206,
		headers: {
			...headers,
			"content-range": `bytes ${start}-${end}/${size}`,
			"content-length": String(end - start + 1),
		},
	});
}

/**
 * One `bytes=` range (pdf.js asks for one at a time) as inclusive offsets, or
 * null when it can't be served. Several ranges are refused too.
 */
export function parseRange(
	header: string,
	size: number,
): [number, number] | null {
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m || (m[1] === "" && m[2] === "")) return null;
	let start: number;
	let end: number;
	if (m[1] === "") {
		// The last N bytes.
		const n = Number(m[2]);
		if (n === 0) return null;
		start = Math.max(0, size - n);
		end = size - 1;
	} else {
		start = Number(m[1]);
		end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
	}
	return start <= end && start < size ? [start, end] : null;
}

type Route = (req: Request) => Response | Promise<Response>;

/**
 * The client's Content-Security-Policy. Diagram blocks are sanitized before
 * they reach the page; this is the second line: no script but our bundle (and
 * the Graphviz WebAssembly), no fetch but our own API, no frames, no plugins.
 */
export const CSP = [
	"default-src 'self'",
	"script-src 'self' 'wasm-unsafe-eval'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self' data:",
	"connect-src 'self'",
	"object-src 'none'",
	"base-uri 'none'",
	"frame-src 'none'",
	"frame-ancestors 'none'",
	"form-action 'self'",
	"worker-src 'self' blob:",
].join("; ");

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
			: { "content-security-policy": CSP };
		routes[`/${path}`] = wrap(() => new Response(file, { headers }));
	}
	routes["/*"] = wrap((req) =>
		extname(new URL(req.url).pathname)
			? new Response("Not found", { status: 404 })
			: new Response(index, { headers: { "content-security-policy": CSP } }),
	);
	return { routes, index };
}
