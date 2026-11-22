import { extname, join, resolve } from "node:path";
import { type ZodType, z } from "zod";
import {
	ClientMessage,
	CreateSessionBody,
	type CreateSessionResponse,
	type ErrorResponse,
	type InterruptResponse,
	SendMessageBody,
	type ServerMessage,
	type StateResponse,
} from "../shared/protocol.ts";
import type { AgentDriver } from "./agent/driver.ts";
import { Sessions, topic } from "./sessions.ts";

export type ServerOptions = {
	port: number;
	/**
	 * Directory of the built client (`vite build`) to serve. In dev it is null:
	 * the Vite dev server serves the client and forwards `/api` and `/ws` here.
	 */
	distDir: string | null;
	driver: AgentDriver;
};

/** Per-socket data. Empty until auth (step 4) adds the device. */
type Socket = Record<string, never>;

const HOST = "127.0.0.1";

export async function startServer({ port, distDir, driver }: ServerOptions) {
	const sessions = new Sessions(driver, (name, message) =>
		server.publish(name, JSON.stringify(message)),
	);
	const server: Bun.Server<Socket> = Bun.serve({
		hostname: HOST,
		port,
		maxRequestBodySize: 1024 * 1024,
		routes: {
			...(distDir ? await clientRoutes(distDir) : {}),
			"/api/state": {
				GET: () => {
					const list = sessions.list();
					const courses = [...new Set(list.map((s) => s.course))].sort();
					return Response.json({
						courses,
						sessions: list,
					} satisfies StateResponse);
				},
			},
			"/api/sessions": {
				POST: (req) =>
					withBody(req, CreateSessionBody, (body) =>
						Response.json(
							{ id: sessions.create(body).id } satisfies CreateSessionResponse,
							{ status: 201 },
						),
					),
			},
			"/api/sessions/:id": {
				GET: (req) => found(sessions.snapshot(req.params.id)),
			},
			"/api/sessions/:id/messages": {
				POST: (req) =>
					withBody(req, SendMessageBody, (body) =>
						found(sessions.send(req.params.id, body), 202),
					),
			},
			"/api/sessions/:id/interrupt": {
				POST: async (req) => {
					const interrupted = await sessions.interrupt(req.params.id);
					return found(
						interrupted === undefined
							? undefined
							: ({ interrupted } satisfies InterruptResponse),
					);
				},
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
				const snapshot = sessions.snapshot(session);
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
	});
	return server;
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
