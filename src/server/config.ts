/**
 * `config.json` in `~/Library/Application Support/lemma/` (or
 * `LEMMA_CONFIG_DIR`): the study folder chosen on first run, and the port.
 * `LEMMA_STUDY_DIR` overrides the folder, for tests.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

const Config = z.looseObject({
	folder: z.string().optional(),
	port: z.number().int().min(1).max(65535).optional(),
});
type Config = z.infer<typeof Config>;

export function configDir(env = process.env) {
	return (
		env.LEMMA_CONFIG_DIR ??
		join(homedir(), "Library", "Application Support", "lemma")
	);
}

export function readConfig(dir = configDir()): Config {
	try {
		return Config.parse(
			JSON.parse(readFileSync(join(dir, "config.json"), "utf8")),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw new Error(`${join(dir, "config.json")} is not valid: ${error}`);
	}
}

export function saveConfig(patch: Partial<Config>, dir = configDir()) {
	mkdirSync(dir, { recursive: true });
	const next = { ...readConfig(dir), ...patch };
	writeFileSync(join(dir, "config.json"), `${JSON.stringify(next, null, 2)}\n`);
}

/** `~/x` → the home folder's `x`. */
export function expandHome(path: string, home = homedir()) {
	return path === "~" || path.startsWith("~/")
		? join(home, path.slice(1))
		: path;
}

export type FolderChoice = { dir: string } | { code: string; message: string };

/**
 * The folder a first-run path names, made if it doesn't exist. Folders that
 * would hand Claude far more than course material are refused: `/`, the home
 * folder and those above it, `~/Library`, and hidden folders.
 */
export function chooseStudyFolder(
	input: string,
	home = homedir(),
): FolderChoice {
	const path = expandHome(input.trim(), home);
	if (!isAbsolute(path)) {
		return { code: "bad_request", message: "use a full path, like ~/Estudio" };
	}
	const dir = resolve(path);
	const root = resolve(home);
	if (
		dir === "/" ||
		dir === root ||
		root.startsWith(`${dir}/`) ||
		`${dir}/`.startsWith(join(root, "Library/")) ||
		dir.split("/").some((part) => part.startsWith("."))
	) {
		return {
			code: "too_broad",
			message:
				"choose a folder of your own, not the home folder, a folder above it, Library or a hidden folder",
		};
	}
	try {
		mkdirSync(dir, { recursive: true });
		if (!statSync(dir).isDirectory()) throw new Error("not a folder");
	} catch {
		return {
			code: "not_a_folder",
			message: "that path is not a folder you can use",
		};
	}
	return { dir };
}
