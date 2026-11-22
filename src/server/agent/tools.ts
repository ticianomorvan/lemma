/**
 * Which tool calls the agent may make. The SDK runs this before every call
 * (a `PreToolUse` hook) and again when it asks for permission (`canUseTool`):
 * the SDK approves `Read`s inside the folder on its own without asking, so the
 * hook is what makes the jail hold for every call.
 */
import type { Folder } from "../folder/folder.ts";
import { writeDenied } from "../folder/layout.ts";

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
		// The tools expand `~` to the home folder; the jail would read it as a
		// folder named `~` inside the root.
		if (path.startsWith("~")) return `${path} is outside the study folder`;
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
