/**
 * Which tool calls the agent may make. The SDK runs this before every call
 * (a `PreToolUse` hook) and again when it asks for permission (`canUseTool`):
 * the SDK approves `Read`s inside the folder on its own without asking, so the
 * hook is what makes the jail hold for every call.
 */
import type { Folder } from "../folder/folder.ts";

/** The agent's tools. `Bash`, `NotebookEdit` and `Task` are also disallowed. */
export const TOOLS = ["Read", "Glob", "Grep", "Write", "Edit"];
const WRITES = new Set(["Write", "Edit"]);

/** Null when the call may run, otherwise why it may not (shown to Claude). */
export function checkTool(
	folder: Folder,
	name: string,
	input: Record<string, unknown>,
): string | null {
	if (!TOOLS.includes(name)) return `${name} is not available in Lemma`;
	const paths = [input.file_path, input.path].filter(
		(p): p is string => typeof p === "string",
	);
	if (WRITES.has(name) && paths.length === 0) return "a file_path is required";
	for (const path of paths) {
		const real = folder.resolve(path);
		if (real === null) return `${path} is outside the study folder`;
		if (WRITES.has(name)) {
			const denied = writeDenied(folder.relative(real));
			if (denied) return denied;
		}
	}
	// Globs are relative to `path`, so a `..` in one could leave the folder.
	// (Grep's `pattern` is a regex, not a path.)
	const glob = name === "Glob" ? input.pattern : input.glob;
	if (
		typeof glob === "string" &&
		(glob.startsWith("/") || glob.split("/").includes(".."))
	) {
		return "globs must stay inside the study folder";
	}
	return null;
}

/**
 * Claude may write anywhere in the folder except over what the app owns: the
 * transcripts, the phone inbox, and `.claude/` settings (skills are fine).
 */
export function writeDenied(relative: string): string | null {
	if (relative === "") return "cannot write the study folder itself";
	// Lowercased: macOS folders are case-insensitive, so SESSIONS/ is sessions/.
	const [top, second] = relative.toLowerCase().split("/");
	if (top === ".claude" && second !== "skills") {
		return "writes under .claude/ are limited to .claude/skills/";
	}
	if (top === "inbox") return "inbox/ is managed by Lemma";
	if (second === "sessions" || top === "sessions") {
		return "session transcripts are managed by Lemma";
	}
	return null;
}
