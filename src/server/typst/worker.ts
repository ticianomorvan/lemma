/**
 * The Typst Worker: typst.ts's compiler and SVG renderer (WebAssembly), with
 * the fonts and the one package Lemma ships. It loads once and stays warm;
 * `typst.ts` sends it one job at a time and kills it when a job runs too long.
 *
 * Nothing here touches the network, and a document reads only what its job
 * allows (see `Access`):
 * - an `svg` job (a `typst` block) reads nothing: its source is the only file;
 * - a `pdf` job reads either the files it lists (an export: the `.typ` and its
 *   photos) or the study folder through its jail (a note's preview), never a
 *   hidden path (`.claude/…`) or anything outside it;
 * - `@preview/mitex` (LaTeX math, for exports) comes from `assets/packages`;
 *   every other package is "not found".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
	createTypstCompiler,
	createTypstRenderer,
} from "@myriaddreamin/typst.ts";
import { CompileFormatEnum } from "@myriaddreamin/typst.ts/compiler";
import {
	loadFonts,
	withAccessModel,
	withPackageRegistry,
} from "@myriaddreamin/typst.ts/options.init";
import { Folder } from "../folder/folder.ts";
import { MITEX, type TypstJob, type TypstReply } from "./typst.ts";

declare const self: Worker;

// No network, by construction: a compile, a font or a package that reached
// for one would fail here instead of fetching (the Worker has its own globals).
globalThis.fetch = Object.assign(
	() => Promise.reject(new Error("the Typst worker has no network")),
	{ preconnect: () => {} },
) as unknown as typeof fetch;

const ASSETS = join(import.meta.dir, "assets");
const FONTS = join(ASSETS, "fonts");
const PACKAGES = join(ASSETS, "packages");
/** The one package a document may import (exports only). */
const SHIPPED = `${MITEX.namespace}/${MITEX.name}/${MITEX.version}`;
/** Where packages appear to the compiler; never a real path. */
const PACKAGE_ROOT = "/@lemma/packages";
/** The virtual folder an `svg` job's source lives in. */
const BLOCK_ROOT = "/@lemma/block";
const BLOCK_MAIN = `${BLOCK_ROOT}/main.typ`;
/**
 * What every block is compiled with, on one line before its source: a page
 * that hugs its content, on a transparent background, at a size that reads
 * like the answer's text.
 */
const BLOCK_PRELUDE =
	"#set page(width: auto, height: auto, margin: 4pt, fill: none); #set text(size: 12pt)\n";
/**
 * A package's WebAssembly, in the `{module_or_path}` form wasm-bindgen asks
 * for (bare bytes still work, with a deprecation warning).
 */
const wasm = (pkg: string) =>
	({
		module_or_path: readFileSync(
			Bun.fileURLToPath(import.meta.resolve(`${pkg}/wasm`)),
		),
	}) as unknown as Uint8Array;

/** What the job running now may read, besides the shipped packages. */
type Access =
	| { kind: "none" }
	| { kind: "files"; files: Set<string> }
	| { kind: "folder"; folder: Folder };
let access: Access = { kind: "none" };
/** Packages are for exports; a block or a note gets none. */
let packagesAllowed = false;

/** The real file `path` names, if the current job may read it. */
function allowed(path: string): string | null {
	if (path.startsWith(`${PACKAGE_ROOT}/`)) {
		const real = resolve(PACKAGES, path.slice(PACKAGE_ROOT.length + 1));
		return real.startsWith(PACKAGES + sep) ? real : null;
	}
	switch (access.kind) {
		case "none":
			return null;
		case "files":
			return access.files.has(path) ? path : null;
		case "folder":
			// The same jail as `/files/*`: no hidden names (`.claude/…`).
			return access.folder.resolveVisible(access.folder.relative(path));
	}
}

function isFile(path: string) {
	const real = allowed(path);
	try {
		return real !== null && statSync(real).isFile();
	} catch {
		return false;
	}
}

const accessModel = {
	getMTime(path: string) {
		const real = allowed(path);
		try {
			return real ? statSync(real).mtime : undefined;
		} catch {
			return undefined;
		}
	},
	isFile,
	getRealPath(path: string) {
		return path;
	},
	readAll(path: string) {
		const real = isFile(path) ? allowed(path) : null;
		return real ? new Uint8Array(readFileSync(real)) : undefined;
	},
};

const registry = {
	resolve(spec: { namespace: string; name: string; version: string }) {
		const id = `${spec.namespace}/${spec.name}/${spec.version}`;
		return packagesAllowed && id === SHIPPED
			? `${PACKAGE_ROOT}/${id}`
			: undefined;
	},
};

const compiler = createTypstCompiler();
await compiler.init({
	getModule: () => wasm("@myriaddreamin/typst-ts-web-compiler"),
	beforeBuild: [
		// biome-ignore lint/suspicious/noExplicitAny: typst.ts types its models loosely
		withAccessModel(accessModel as any),
		// biome-ignore lint/suspicious/noExplicitAny: as above
		withPackageRegistry(registry as any),
		// Our fonts only. `assets: false` matters: without a loader that says
		// so, typst.ts adds one that downloads its defaults from a CDN.
		loadFonts(
			readdirSync(FONTS)
				.filter((f) => /\.(otf|ttf)$/.test(f))
				.map((f) => new Uint8Array(readFileSync(join(FONTS, f)))),
			{ assets: false },
		),
	],
});
const renderer = createTypstRenderer();
await renderer.init({
	getModule: () => wasm("@myriaddreamin/typst-ts-renderer"),
});

type Diagnostic = {
	severity: string;
	message: string;
	path?: string;
	range?: string;
	hints?: string[];
};

/** The first error, in Spanish where we know the message. */
function failure(diagnostics: Diagnostic[] | undefined, lineOffset: number) {
	const first =
		diagnostics?.find((d) => d.severity === "error") ?? diagnostics?.[0];
	if (!first) return "Typst no produjo un documento";
	const where = /^(\d+):(\d+)/.exec(first.range ?? "");
	const line = where ? Number(where[1]) + 1 - lineOffset : 0;
	// A block is one file; a note names the file the error is in.
	const file =
		first.path && first.path !== BLOCK_MAIN
			? `${first.path.split("/").pop()}, `
			: "";
	const at = line > 0 ? `${file}línea ${line}: ` : "";
	return at + translate(first.message);
}

function translate(message: string): string {
	const pkg = /^package not found \(searched for (.+)\)$/.exec(message);
	if (pkg) {
		return `el paquete ${pkg[1]} no está disponible: Lemma no descarga paquetes de Typst`;
	}
	if (/^failed to load file \((is a directory|not found)\)/.test(message)) {
		return "el archivo no existe o no se puede leer desde aquí";
	}
	if (/^failed to load file \(access denied\)/.test(message)) {
		return "no se puede leer un archivo fuera de la carpeta";
	}
	return message;
}

/**
 * typst.ts's SVG carries a viewer script (not even well-formed XML: its
 * `&&` isn't escaped) and an HTML text layer for selection. Both are its own
 * output, never the source's (Typst escapes text it draws), and the client's
 * sanitizer would drop them anyway; dropping them here lets the SVG parse.
 */
function drawingOnly(svg: string): string {
	return svg
		.replace(/<script\b[\s\S]*?<\/script>/g, "")
		.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/g, "");
}

async function run(job: TypstJob): Promise<TypstReply> {
	compiler.resetShadow();
	if (job.kind === "svg") {
		access = { kind: "none" };
		packagesAllowed = false;
		compiler.addSource(BLOCK_MAIN, BLOCK_PRELUDE + job.source);
		const out = await compiler.compile({
			mainFilePath: BLOCK_MAIN,
			root: BLOCK_ROOT,
			format: CompileFormatEnum.vector,
			diagnostics: "full",
		});
		if (!out.result) {
			return {
				id: job.id,
				ok: false,
				error: failure(out.diagnostics as Diagnostic[], 1),
			};
		}
		const svg = await renderer.runWithSession(async (session) => {
			renderer.manipulateData({
				renderSession: session,
				action: "reset",
				data: out.result as Uint8Array,
			});
			return renderer.renderSvg({ renderSession: session });
		});
		return { id: job.id, ok: true, value: drawingOnly(svg) };
	}
	const folder = new Folder(job.root);
	const main = folder.resolve(job.main);
	if (!main || main === folder.root) {
		return { id: job.id, ok: false, error: "el archivo no está en la carpeta" };
	}
	access =
		job.kind === "preview"
			? { kind: "folder", folder }
			: {
					kind: "files",
					files: new Set(job.files.flatMap((f) => folder.resolve(f) ?? [])),
				};
	packagesAllowed = job.kind === "export";
	try {
		const root = folder.root;
		const out = await compiler.compile({
			mainFilePath: main,
			root,
			format: CompileFormatEnum.pdf,
			diagnostics: "full",
		});
		return out.result
			? { id: job.id, ok: true, value: out.result as Uint8Array }
			: {
					id: job.id,
					ok: false,
					error: failure(out.diagnostics as Diagnostic[], 0),
				};
	} finally {
		access = { kind: "none" };
		packagesAllowed = false;
	}
}

self.onmessage = async (event: MessageEvent<TypstJob>) => {
	let reply: TypstReply;
	try {
		reply = await run(event.data);
	} catch (cause) {
		// A trap (a panic, memory) leaves the WebAssembly instance unusable:
		// `typst.ts` drops this Worker.
		reply = {
			id: event.data.id,
			ok: false,
			fatal: true,
			error: "Typst falló: el documento pide demasiada memoria o recursión",
		};
		console.error("typst worker:", cause);
	}
	postMessage(reply);
};
postMessage("ready");
