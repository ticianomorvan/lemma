/**
 * `config.json` in `~/Library/Application Support/lemma/` (or
 * `LEMMA_CONFIG_DIR`): the study folder chosen on first run, and the port.
 * `LEMMA_STUDY_DIR` overrides the folder, for tests.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
export function expandHome(path: string) {
	return path === "~" || path.startsWith("~/")
		? join(homedir(), path.slice(1))
		: path;
}
