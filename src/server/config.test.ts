import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseStudyFolder, readConfig, saveConfig } from "./config.ts";

let home: string;

beforeEach(async () => {
	home = await realpath(await mkdtemp(join(tmpdir(), "lemma-home-")));
});

afterEach(async () => {
	await rm(home, { recursive: true });
});

test("config.json keeps the chosen folder and the port", () => {
	const dir = join(home, "config");
	expect(readConfig(dir)).toEqual({});
	saveConfig({ folder: "/Users/x/Estudio" }, dir);
	saveConfig({ port: 4400 }, dir);
	expect(readConfig(dir)).toEqual({ folder: "/Users/x/Estudio", port: 4400 });
});

test("a folder inside home is made and chosen, ~ included", () => {
	expect(chooseStudyFolder("~/Estudio", home)).toEqual({
		dir: join(home, "Estudio"),
	});
	expect(chooseStudyFolder(` ${join(home, "Facultad/2026")} `, home)).toEqual({
		dir: join(home, "Facultad/2026"),
	});
});

test("folders that would give Claude too much are refused", () => {
	for (const path of [
		"/",
		"~",
		home,
		join(home, ".."),
		"~/Library",
		"~/Library/Estudio",
		"~/.ssh",
		"~/x/.oculta",
	]) {
		expect(chooseStudyFolder(path, home)).toMatchObject({ code: "too_broad" });
	}
	// Library's neighbours are fine.
	expect(chooseStudyFolder("~/LibraryNotes", home)).toHaveProperty("dir");
});

test("a relative path or a file is refused", async () => {
	expect(chooseStudyFolder("Estudio", home)).toMatchObject({
		code: "bad_request",
	});
	await writeFile(join(home, "archivo"), "x");
	expect(chooseStudyFolder("~/archivo", home)).toMatchObject({
		code: "not_a_folder",
	});
});
