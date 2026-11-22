/**
 * All I/O under the study root. Every path goes through `resolve`, the path
 * jail: it follows symlinks with `realpath` and answers null for anything that
 * lands outside the root, so a link pointing out of the folder is refused like
 * `../`. See docs/architecture.md → Modules and Security.
 *
 * File operations are synchronous on purpose: transcripts are small, and a
 * read-modify-write that can't interleave with another one needs no locking.
 */
import { createHash } from "node:crypto";
import {
	type FSWatcher,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	watch,
	writeFileSync,
} from "node:fs";
import {
	basename,
	dirname,
	join,
	relative,
	resolve as resolvePath,
	sep,
} from "node:path";

export type FolderChange = { path: string; kind: "change" | "rename" };

export type FolderEntry = { name: string; dir: boolean };

/** Changes to the same path within this window are reported once. */
const DEBOUNCE_MS = 150;
/** Temporary files of `writeAtomic`, which the watcher never reports. */
const TEMP = /^\..+\.lemma-tmp$/;

export class Folder {
	/** The study root, with symlinks resolved. */
	readonly root: string;
	/** Content hashes of our own last writes, so the watcher can skip them. */
	private readonly written = new Map<string, string>();

	constructor(root: string) {
		this.root = realpathSync.native(root);
	}

	/**
	 * The real absolute path of `path` (relative to the root, or absolute), or
	 * null when it is outside the root. A path that doesn't exist yet is
	 * checked through its nearest existing ancestor.
	 */
	resolve(path: string): string | null {
		const absolute = resolvePath(this.root, path);
		const missing: string[] = [];
		let existing = absolute;
		while (true) {
			try {
				// `native` also gives each existing part its on-disk case.
				const real = join(realpathSync.native(existing), ...missing.reverse());
				return this.contains(real) ? real : null;
			} catch {
				const parent = dirname(existing);
				if (parent === existing) return null;
				missing.push(basename(existing));
				existing = parent;
			}
		}
	}

	/** The root-relative form of a path inside the root, with `/` separators. */
	relative(absolute: string): string {
		return relative(this.root, absolute).split(sep).join("/");
	}

	read(path: string): string {
		return readFileSync(this.jailed(path), "utf8");
	}

	/** Writes through a temporary file and a rename, creating parent folders. */
	writeAtomic(path: string, content: string) {
		const target = this.jailed(path);
		mkdirSync(dirname(target), { recursive: true });
		const temp = join(
			dirname(target),
			`.${basename(target)}.${crypto.randomUUID().slice(0, 8)}.lemma-tmp`,
		);
		try {
			writeFileSync(temp, content);
			renameSync(temp, target);
		} catch (error) {
			rmSync(temp, { force: true });
			throw error;
		}
		this.written.set(this.relative(target), hash(content));
	}

	modified(path: string): Date {
		return statSync(this.jailed(path)).mtime;
	}

	/** Creates a folder (and its parents) inside the root. */
	mkdir(path: string) {
		mkdirSync(this.jailed(path), { recursive: true });
	}

	/** The entries of a folder, without dotfiles. Empty when it doesn't exist. */
	list(path = ""): FolderEntry[] {
		try {
			return readdirSync(this.jailed(path), { withFileTypes: true })
				.filter((e) => !e.name.startsWith("."))
				.map((e) => ({ name: e.name, dir: e.isDirectory() }))
				.sort((a, b) => a.name.localeCompare(b.name));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
	}

	/**
	 * Reports changes anywhere under the root, debounced per path. Our own
	 * `writeAtomic`s are skipped by content hash, so only edits made by
	 * something else (an editor, Claude's tools, Finder) come through.
	 */
	watch(onChange: (change: FolderChange) => void): () => void {
		const pending = new Map<string, ReturnType<typeof setTimeout>>();
		const kinds = new Map<string, FolderChange["kind"]>();
		const watcher: FSWatcher = watch(
			this.root,
			{ recursive: true },
			(event, name) => {
				if (!name || TEMP.test(basename(name))) return;
				const path = name.split(sep).join("/");
				// A rename anywhere in the window wins: the file may be gone.
				if (kinds.get(path) !== "rename") kinds.set(path, event);
				clearTimeout(pending.get(path));
				pending.set(
					path,
					setTimeout(() => {
						pending.delete(path);
						const kind = kinds.get(path) ?? "change";
						kinds.delete(path);
						if (this.isOurs(path)) return;
						onChange({ path, kind });
					}, DEBOUNCE_MS),
				);
			},
		);
		return () => {
			watcher.close();
			for (const timer of pending.values()) clearTimeout(timer);
		};
	}

	private isOurs(path: string) {
		const ours = this.written.get(path);
		if (ours === undefined) return false;
		try {
			return hash(readFileSync(join(this.root, path), "utf8")) === ours;
		} catch {
			return false;
		}
	}

	private contains(real: string) {
		return real === this.root || real.startsWith(this.root + sep);
	}

	private jailed(path: string): string {
		const real = this.resolve(path);
		if (real === null) throw new OutsideFolderError(path);
		return real;
	}
}

export class OutsideFolderError extends Error {
	constructor(path: string) {
		super(`${path} is outside the study folder`);
	}
}

const hash = (content: string) =>
	createHash("sha256").update(content).digest("hex");
