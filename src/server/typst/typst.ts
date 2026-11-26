/**
 * Typst on the server: `typst` blocks to SVG, `.typ` notes and session
 * exports to PDF. The compiler (typst.ts, WebAssembly) runs in one Worker
 * (`worker.ts`) that loads in about half a second and then stays warm, so
 * the page never loads the 28 MB compiler and a phone renders blocks as fast
 * as the desktop. See docs/architecture.md → Typst.
 *
 * Jobs run one at a time. One that runs past its limit (a loop, say) gets its
 * Worker killed; the next job starts a fresh one. A source is model-written,
 * so the limits, not the source, decide how long the server works on it.
 */

export type TypstJob = { id: number } & (
	| {
			kind: "svg";
			/** Set rules put before the source; error lines skip them. */
			prelude: string;
			source: string;
	  }
	| {
			kind: "pdf";
			/** The study folder: the document's root. */
			root: string;
			/** The main file, relative to the root. */
			main: string;
			/** Root-relative paths the document may read, or the whole folder (jailed). */
			files: string[] | "folder";
			/** May import the packages Lemma ships (mitex, for exports). */
			packages: boolean;
	  }
);

export type TypstReply = { id: number } & (
	| { ok: true; svg?: string; pdf?: Uint8Array }
	| { ok: false; error: string; fatal?: boolean }
);

type WithoutId<J> = J extends unknown ? Omit<J, "id"> : never;

export type TypstResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: string };

/** How long one block may take to compile and draw. */
export const SVG_TIMEOUT_MS = 5_000;
/** How long a note or an export may take. */
export const PDF_TIMEOUT_MS = 20_000;
/** How long the Worker may take to load the compiler and fonts. */
const STARTUP_MS = 20_000;
/** The longest `typst` block accepted (client/blocks/kinds.ts agrees). */
export const MAX_BLOCK_SOURCE = 20_000;

/**
 * What every block is compiled with: a page that hugs its content, on a
 * transparent background, at a size that reads like the answer's text.
 */
export const BLOCK_PRELUDE =
	"#set page(width: auto, height: auto, margin: 4pt, fill: none); #set text(size: 12pt)\n";

export class Typst {
	private worker: Promise<Worker> | undefined;
	private queue: Promise<unknown> = Promise.resolve();
	private nextId = 1;
	private readonly svgTimeout: number;
	private readonly pdfTimeout: number;

	constructor({
		svgTimeoutMs = SVG_TIMEOUT_MS,
		pdfTimeoutMs = PDF_TIMEOUT_MS,
	} = {}) {
		this.svgTimeout = svgTimeoutMs;
		this.pdfTimeout = pdfTimeoutMs;
	}

	/** A `typst` block's SVG (not yet sanitized: the client does that). */
	svg(source: string): Promise<TypstResult<string>> {
		if (source.length > MAX_BLOCK_SOURCE) {
			return Promise.resolve({
				ok: false,
				error: `el bloque es demasiado largo (máx. ${MAX_BLOCK_SOURCE} caracteres)`,
			});
		}
		return this.run(
			{ kind: "svg", prelude: BLOCK_PRELUDE, source },
			this.svgTimeout,
			(r) => r.svg,
		);
	}

	/** A document in the study folder, as PDF. */
	pdf(job: {
		root: string;
		main: string;
		files: string[] | "folder";
		packages?: boolean;
	}): Promise<TypstResult<Uint8Array>> {
		return this.run(
			{ kind: "pdf", packages: false, ...job },
			this.pdfTimeout,
			(r) => r.pdf,
		);
	}

	/** Starts the Worker now, so the first block doesn't wait for it. */
	warm() {
		void this.ready().catch(() => {});
	}

	close() {
		const worker = this.worker;
		this.worker = undefined;
		void worker?.then((w) => w.terminate()).catch(() => {});
	}

	private run<T>(
		job: WithoutId<TypstJob>,
		timeout: number,
		pick: (reply: Extract<TypstReply, { ok: true }>) => T | undefined,
	): Promise<TypstResult<T>> {
		const result = this.queue.then(() =>
			this.send({ ...job, id: this.nextId++ } as TypstJob, timeout, pick),
		);
		this.queue = result;
		return result;
	}

	private async send<T>(
		job: TypstJob,
		timeout: number,
		pick: (reply: Extract<TypstReply, { ok: true }>) => T | undefined,
	): Promise<TypstResult<T>> {
		let worker: Worker;
		try {
			worker = await this.ready();
		} catch (cause) {
			return { ok: false, error: (cause as Error).message };
		}
		return new Promise((resolve) => {
			const done = (result: TypstResult<T>) => {
				clearTimeout(timer);
				worker.onmessage = null;
				worker.onerror = null;
				resolve(result);
			};
			const timer = setTimeout(() => {
				// The source may never finish: drop this Worker, the next job
				// gets a fresh one.
				this.kill(worker);
				done({
					ok: false,
					error: `Typst se detuvo tras ${timeout / 1000} s`,
				});
			}, timeout);
			worker.onmessage = (event: MessageEvent<TypstReply>) => {
				const reply = event.data;
				if (reply.id !== job.id) return;
				if (!reply.ok) {
					if (reply.fatal) this.kill(worker);
					return done({ ok: false, error: reply.error });
				}
				const value = pick(reply);
				done(
					value === undefined
						? { ok: false, error: "Typst no devolvió nada" }
						: { ok: true, value },
				);
			};
			worker.onerror = (event) => {
				this.kill(worker);
				done({ ok: false, error: event.message || "Typst falló" });
			};
			worker.postMessage(job);
		});
	}

	private kill(worker: Worker) {
		worker.terminate();
		this.worker = undefined;
	}

	/** The warm Worker, started (once) if there is none. */
	private ready(): Promise<Worker> {
		this.worker ??= spawn().catch((cause) => {
			this.worker = undefined;
			throw cause;
		});
		return this.worker;
	}
}

function spawn(): Promise<Worker> {
	const worker = new Worker(new URL("./worker.ts", import.meta.url));
	// Bun's Worker has `unref`; the DOM typings the client needs don't.
	(worker as Worker & { unref(): void }).unref();
	return new Promise<Worker>((resolve, reject) => {
		const fail = (message: string) => {
			clearTimeout(timer);
			worker.terminate();
			reject(new Error(message));
		};
		const timer = setTimeout(
			() => fail("Typst no arrancó a tiempo"),
			STARTUP_MS,
		);
		worker.onmessage = () => {
			clearTimeout(timer);
			worker.onmessage = null;
			worker.onerror = null;
			resolve(worker);
		};
		worker.onerror = (event) => fail(event.message || "Typst no arrancó");
	});
}
