import { extname, join, resolve } from "node:path";

export type ServerOptions = {
	port: number;
	/**
	 * Directory of the built client (`vite build`) to serve. In dev it is null:
	 * the Vite dev server serves the client and forwards `/api` and `/ws` here.
	 */
	distDir: string | null;
};

const HOST = "127.0.0.1";

export async function startServer({ port, distDir }: ServerOptions) {
	return Bun.serve({
		hostname: HOST,
		port,
		routes: distDir ? await clientRoutes(distDir) : {},
		fetch: notFound,
	});
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
		extname(new URL(req.url).pathname) ? notFound() : new Response(index);
	return routes;
}

function notFound() {
	return new Response("Not found", { status: 404 });
}
