import { join, resolve } from "node:path";

export type ServerOptions = {
	port: number;
	/** Serve the built client from this directory. Without it, the client is bundled on the fly (dev). */
	distDir?: string;
};

const HOST = "127.0.0.1";

export async function startServer({ port, distDir }: ServerOptions) {
	return Bun.serve({
		hostname: HOST,
		port,
		routes: distDir ? await staticRoutes(distDir) : await devRoutes(),
		development: !distDir && { hmr: true, console: true },
		fetch: () => new Response("Not found", { status: 404 }),
	});
}

/** Bun's HTML import: bundles the client on request, with hot reload. */
async function devRoutes() {
	const { default: index } = await import("../client/index.html");
	return { "/*": index };
}

/** One route per file in the build output, and the SPA shell for every other path. */
async function staticRoutes(distDir: string) {
	const root = resolve(distDir);
	const index = Bun.file(join(root, "index.html"));
	if (!(await index.exists())) {
		throw new Error(
			`${root}/index.html not found; run \`bun run build\` first`,
		);
	}
	const routes: Record<string, Response> = {};
	for await (const path of new Bun.Glob("**/*").scan(root)) {
		routes[`/${path}`] = new Response(Bun.file(join(root, path)));
	}
	routes["/*"] = new Response(index);
	return routes;
}
