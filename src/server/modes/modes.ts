/**
 * Study modes (see docs/architecture.md → Study modes). A mode is an Agent SDK
 * skill in the study folder, `.claude/skills/<mode>/SKILL.md`, so the student
 * edits it as text: the folder is the truth. The app ships four defaults
 * (`defaults/`) and writes each one only where no file is, so an edited,
 * renamed or replaced mode is never overwritten.
 *
 * The session's `mode` reaches Claude as that file's text, sent by the
 * sessions module with the next message (`modeMessage`).
 */
import { readFileSync } from "node:fs";
import { MODE_ID, type Mode } from "../../shared/protocol.ts";
import type { Folder } from "../folder/folder.ts";
import { SKILLS, skillFile } from "../folder/layout.ts";

/** The modes the app ships, in the order the chips show them. */
export const DEFAULT_MODES = ["read-along", "explain", "review", "exam-prep"];

const DEFAULTS = new URL("./defaults/", import.meta.url);

/** A shipped mode's SKILL.md, as written into a new folder. */
export function defaultSkill(mode: string): string {
	return readFileSync(new URL(`${mode}/SKILL.md`, DEFAULTS), "utf8");
}

/**
 * Writes each default mode whose SKILL.md is missing. Never replaces a file:
 * the student's edits win. Returns the modes it wrote.
 */
export function installModes(folder: Folder): string[] {
	return DEFAULT_MODES.filter((mode) => {
		try {
			return folder.writeNew(skillFile(mode), defaultSkill(mode));
		} catch (error) {
			// A `.claude` that is a file, or unwritable: run without that mode.
			console.error(`could not install the ${mode} mode:`, error);
			return false;
		}
	});
}

/**
 * The folder's modes: each `.claude/skills/<id>/SKILL.md` that reads, with the
 * `label` from its front matter (else its id). The shipped ones come first,
 * in their order, then any the student added.
 */
export function listModes(folder: Folder): Mode[] {
	const modes: Mode[] = [];
	for (const entry of folder.list(SKILLS)) {
		if (!entry.dir || !MODE_ID.test(entry.name)) continue;
		const skill = readSkill(folder, entry.name);
		if (!skill) continue;
		const { label, description } = skill;
		modes.push({
			id: entry.name,
			label,
			...(description ? { description } : {}),
		});
	}
	const rank = (id: string) => {
		const i = DEFAULT_MODES.indexOf(id);
		return i === -1 ? DEFAULT_MODES.length : i;
	};
	return modes.sort(
		(a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id),
	);
}

/** A mode's label and instructions (the SKILL.md body), or null if it is gone. */
export function readSkill(
	folder: Folder,
	mode: string,
): { label: string; description?: string; body: string } | null {
	if (!MODE_ID.test(mode)) return null;
	let text: string;
	try {
		text = folder.read(skillFile(mode));
	} catch {
		return null;
	}
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
	let label = mode;
	let description: string | undefined;
	if (match) {
		try {
			const raw = Bun.YAML.parse(match[1] ?? "") as Record<
				string,
				unknown
			> | null;
			const value = raw?.label ?? raw?.name;
			if (typeof value === "string" && value.trim()) label = value.trim();
			if (typeof raw?.description === "string") {
				description = raw.description.trim() || undefined;
			}
		} catch {
			// A broken header: the body still steers Claude.
		}
	}
	const body = (match ? text.slice(match[0].length) : text).trim();
	return { label, ...(description ? { description } : {}), body };
}

/**
 * What Claude gets ahead of a message when the session's mode changed since
 * the agent's last message (or the agent is new): the mode's instructions, or
 * a note that the mode is off. Null when there is nothing to say.
 */
export function modeMessage(
	folder: Folder,
	mode: string | undefined,
	known: string | null | undefined,
): string | null {
	if (mode === undefined) {
		// `known` undefined: a resumed agent may still follow an old mode.
		if (known === null) return null;
		return [
			"<mode>",
			"The student turned the study mode off. From now on answer normally; stop following any earlier mode's instructions.",
			"</mode>",
		].join("\n");
	}
	if (mode === known) return null;
	const skill = readSkill(folder, mode);
	if (!skill) return null;
	return [
		`<mode name="${mode}" label="${skill.label.replace(/"/g, "'")}">`,
		"The student picked this study mode for the session. Follow its instructions from now on, until a later <mode> note changes it. They come from the student's study folder (.claude/skills/), and they apply on top of the Lemma conventions.",
		"",
		skill.body.replace(/<(\/?mode)/gi, "&lt;$1"),
		"</mode>",
	].join("\n");
}
