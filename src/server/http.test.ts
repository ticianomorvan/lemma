import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeDriver } from "./agent/fake.ts";
import { startServer } from "./http.ts";

let dir: string;
let server: Awaited<ReturnType<typeof startServer>>;
const driver = new FakeDriver({ streams: ["math"] });

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "lemma-dist-"));
	await writeFile(join(dir, "index.html"), "<title>shell</title>");
	await writeFile(join(dir, "app-abc.js"), "console.log(1)");
	server = await startServer({
		port: 0,
		distDir: dir,
		driver,
		studyDir: null,
	});
});

afterAll(async () => {
	await server.stop(true);
	await rm(dir, { recursive: true });
});

test("binds to loopback only", () => {
	expect(server.hostname).toBe("127.0.0.1");
});

test("serves built files with their content type", async () => {
	const res = await fetch(new URL("/app-abc.js", server.url));
	expect(res.status).toBe(200);
	expect(res.headers.get("content-type")).toContain("javascript");
	expect(await res.text()).toBe("console.log(1)");
});

test("serves the shell for client routes", async () => {
	for (const path of ["/", "/sessions/123"]) {
		const res = await fetch(new URL(path, server.url));
		expect(await res.text()).toBe("<title>shell</title>");
	}
});

test("answers 404, not the shell, for a missing asset", async () => {
	const res = await fetch(new URL("/app-old.js", server.url));
	expect(res.status).toBe(404);
});

test("serves no client in dev", async () => {
	const dev = await startServer({
		port: 0,
		distDir: null,
		driver,
		studyDir: null,
	});
	try {
		expect((await fetch(new URL("/", dev.url))).status).toBe(404);
	} finally {
		await dev.stop(true);
	}
});

test("refuses to start without a build", async () => {
	await expect(
		startServer({
			port: 0,
			distDir: join(dir, "missing"),
			driver,
			studyDir: null,
		}),
	).rejects.toThrow("bun run build");
});
