/**
 * The study folder's layout, in one place (see docs/architecture.md → Files):
 * each top-level folder is a course, its transcripts live in
 * `<course>/sessions/`, and a few names belong to the app.
 */

/** Top-level folders the app owns, which are not courses. */
const RESERVED = new Set(["inbox"]);

export const sessionsDir = (course: string) => `${course}/sessions`;

/** A top-level folder that is a course: not hidden and not reserved. */
export function isCourse(name: string) {
	return !name.startsWith(".") && !RESERVED.has(name.toLowerCase());
}

/** A name a new course may have: a single, visible, unreserved folder name. */
export function isCourseName(name: string) {
	return (
		name.length > 0 &&
		name.trim() === name &&
		!/[/\\:]/.test(name) &&
		isCourse(name)
	);
}

/**
 * Why Claude may not write at a root-relative path, or null. It may write
 * anywhere except over what the app owns: the transcripts, the inbox, and
 * `.claude/` settings (skills are fine). Lowercased, since macOS folders are
 * case-insensitive.
 */
export function writeDenied(relative: string): string | null {
	if (relative === "") return "cannot write the study folder itself";
	const [top = "", second] = relative.toLowerCase().split("/");
	if (top === ".claude" && second !== "skills") {
		return "writes under .claude/ are limited to .claude/skills/";
	}
	if (RESERVED.has(top)) return `${top}/ is managed by Lemma`;
	if (second === "sessions" || top === "sessions") {
		return "session transcripts are managed by Lemma";
	}
	return null;
}
