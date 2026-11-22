import { extname, join, resolve } from "node:path";

export type ServerOptions = {
	port: number;
	/** `dev` bundles the client on request with hot reload; `prod` serves the build in `distDir`. */
	client: { mode: "dev" } | { mode: "prod"; distDir: string };
};

const HOST = "127.0.0.1";

export async function startServer({ port, client }: ServerOptions) {
	const dev = client.mode === "dev";
	return Bun.serve({
		hostname: HOST,
		port,
		routes: dev ? await devRoutes() : await staticRoutes(client.distDir),
		development: dev && { hmr: true, console: true },
		fetch: notFound,
	});
}

/** Bun's HTML import: bundles the client on request, with hot reload. */
async function devRoutes() {
	const { default: index } = await import("../client/index.html");
	return { "/*": index };
}

/**
 * One route per file in the build output. Other paths without an extension get
 * the SPA shell; a missing asset (say, a stale hashed bundle) gets a 404, not HTML.
 */
async function staticRoutes(distDir: string) {
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
