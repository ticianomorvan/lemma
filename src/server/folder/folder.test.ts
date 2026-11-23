import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkTool } from "../agent/tools.ts";
import { Folder, type FolderChange, OutsideFolderError } from "./folder.ts";

let root: string;
let outside: string;
let folder: Folder;

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "lemma-folder-")));
	outside = await realpath(await mkdtemp(join(tmpdir(), "lemma-outside-")));
	await writeFile(join(outside, "secret.txt"), "SECRET\n");
	await mkdir(join(root, "probabilidad", "materials"), { recursive: true });
	await writeFile(join(root, "probabilidad", "materials", "a.md"), "hola\n");
	await symlink(join(outside, "secret.txt"), join(root, "fuga.txt"));
	await symlink(outside, join(root, "probabilidad", "afuera"));
	await symlink(
		join(root, "probabilidad", "materials", "a.md"),
		join(root, "atajo.md"),
	);
	folder = new Folder(root);
});

afterEach(async () => {
	await rm(root, { recursive: true });
	await rm(outside, { recursive: true });
});

test("paths inside the folder resolve, existing or not", () => {
	expect(folder.resolve("probabilidad/materials/a.md")).toBe(
		join(root, "probabilidad/materials/a.md"),
	);
	expect(folder.resolve(join(root, "nuevo/dir/b.md"))).toBe(
		join(root, "nuevo/dir/b.md"),
	);
	expect(folder.resolve("")).toBe(root);
	// A link that stays inside is fine.
	expect(folder.resolve("atajo.md")).toBe(
		join(root, "probabilidad/materials/a.md"),
	);
});

test("a symlink pointing outside the folder is rejected", () => {
	expect(folder.resolve("fuga.txt")).toBeNull();
	expect(folder.resolve("probabilidad/afuera/secret.txt")).toBeNull();
	// Even for a file that doesn't exist yet behind the link.
	expect(folder.resolve("probabilidad/afuera/nuevo.txt")).toBeNull();
	expect(() => folder.read("fuga.txt")).toThrow(OutsideFolderError);
	expect(() => folder.writeAtomic("probabilidad/afuera/x.txt", "x")).toThrow(
		OutsideFolderError,
	);
});

test("a dangling symlink is rejected: a write would follow it out", async () => {
	await symlink(join(outside, "nuevo.md"), join(root, "colgado.md"));
	expect(folder.resolve("colgado.md")).toBeNull();
	expect(folder.resolve("colgado.md/x")).toBeNull();
	expect(write("colgado.md")).toContain("outside");
});

test("`~` paths, which the tools expand to the home folder, are rejected", () => {
	expect(checkTool(folder, "Read", { file_path: "~/.ssh/id_rsa" })).toContain(
		"outside",
	);
	expect(write("~/.zshrc")).toContain("outside");
});

test("`..` and absolute paths elsewhere are rejected", () => {
	expect(folder.resolve("../x")).toBeNull();
	expect(folder.resolve("probabilidad/../../x")).toBeNull();
	expect(folder.resolve(join(outside, "secret.txt"))).toBeNull();
	expect(folder.resolve("/etc/passwd")).toBeNull();
});

test("writeAtomic makes parents and leaves no temporary file", async () => {
	folder.writeAtomic("logica/sessions/s.md", "uno\n");
	folder.writeAtomic("logica/sessions/s.md", "dos\n");
	expect(await readFile(join(root, "logica/sessions/s.md"), "utf8")).toBe(
		"dos\n",
	);
	expect(await readdir(join(root, "logica/sessions"))).toEqual(["s.md"]);
	expect(folder.list().map((e) => e.name)).toEqual([
		"atajo.md",
		"fuga.txt",
		"logica",
		"probabilidad",
	]);
	expect(folder.list("nada")).toEqual([]);
});

test("the watcher reports other writers once, and skips our own writes", async () => {
	const changes: FolderChange[] = [];
	const stop = folder.watch((c) => changes.push(c));
	try {
		folder.writeAtomic("probabilidad/notes/mia.md", "mía\n");
		for (let i = 0; i < 5; i += 1) {
			await writeFile(join(root, "probabilidad/materials/a.md"), `v${i}\n`);
		}
		await Bun.sleep(600);
		const paths = changes.map((c) => c.path);
		expect(
			paths.filter((p) => p === "probabilidad/materials/a.md"),
		).toHaveLength(1);
		expect(paths).not.toContain("probabilidad/notes/mia.md");
		expect(paths.some((p) => p.endsWith(".lemma-tmp"))).toBe(false);
	} finally {
		stop();
	}
});

// ── The agent's tool calls, through the same jail ───────────────────────────

const write = (file_path: string) =>
	checkTool(folder, "Write", { file_path, content: "x" });

test("tool calls outside the folder are denied", () => {
	expect(checkTool(folder, "Read", { file_path: "fuga.txt" })).toContain(
		"outside",
	);
	expect(
		checkTool(folder, "Read", { file_path: join(outside, "secret.txt") }),
	).toContain("outside");
	expect(checkTool(folder, "Grep", { pattern: "x", path: "../" })).toContain(
		"outside",
	);
	expect(checkTool(folder, "Glob", { pattern: "../../**/*.txt" })).toContain(
		"globs",
	);
	expect(
		checkTool(folder, "Grep", { pattern: "..", glob: "/etc/*" }),
	).toContain("globs");
	expect(write("probabilidad/afuera/x.md")).toContain("outside");
	expect(checkTool(folder, "Bash", { command: "ls" })).toContain(
		"not available",
	);
	// Only `study`'s own `calc` gets past the allow-list among MCP tools.
	expect(checkTool(folder, "mcp__study__calc", { expr: "1+1" })).toBeNull();
	expect(checkTool(folder, "mcp__other__calc", { expr: "1+1" })).toContain(
		"not available",
	);
});

test("writes to the transcripts, the inbox and .claude settings are denied", () => {
	expect(write("probabilidad/sessions/2026-11-22-x.md")).toContain("session");
	expect(write(join(root, "probabilidad/Sessions/x.md"))).toContain("session");
	expect(write("inbox/foto.jpg")).toContain("inbox");
	expect(write(".claude/settings.json")).toContain(".claude");
	expect(write(".claude/hooks/x.sh")).toContain(".claude");
	expect(write("")).not.toBeNull();
	expect(
		checkTool(folder, "Edit", {
			file_path: "probabilidad/sessions/a.md",
			old_string: "a",
			new_string: "b",
		}),
	).toContain("session");
});

test("reads anywhere inside, and other writes, are allowed", () => {
	expect(write("probabilidad/notes/resumen.md")).toBeNull();
	expect(write(".claude/skills/review/SKILL.md")).toBeNull();
	expect(
		checkTool(folder, "Read", { file_path: "probabilidad/sessions/a.md" }),
	).toBeNull();
	expect(checkTool(folder, "Read", { file_path: "atajo.md" })).toBeNull();
	expect(checkTool(folder, "Glob", { pattern: "**/*.pdf" })).toBeNull();
	expect(checkTool(folder, "Grep", { pattern: "Var\\(X\\)" })).toBeNull();
});
