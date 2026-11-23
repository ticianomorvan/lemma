/**
 * `calc(expr) → value | error`: evaluates one expression in a fresh Worker,
 * killed after the call or after 1 s. See `engine.ts` for what an expression
 * can reach.
 *
 * Loading mathjs takes a few hundred milliseconds, so the next call's Worker
 * is started as soon as one is taken, and the 1 s clock starts once that
 * Worker is ready. No Worker serves two calls, so nothing an expression does
 * outlives it.
 */
import type { CalcResult } from "./engine.ts";

export type { CalcResult };

/** Expressions longer than this (in UTF-8 bytes) are refused. */
export const MAX_INPUT_BYTES = 2 * 1024;
/** How long one evaluation may run before its Worker is killed. */
export const TIMEOUT_MS = 1000;
/** How long a Worker may take to load before the call fails. */
const STARTUP_MS = 10_000;

let spare: Promise<Worker> | undefined;

export async function calc(expr: string): Promise<CalcResult> {
	if (new TextEncoder().encode(expr).length > MAX_INPUT_BYTES)
		return {
			ok: false,
			error: `the expression is longer than ${MAX_INPUT_BYTES / 1024} KB`,
		};
	const ready = spare ?? spawn();
	spare = spawn();
	let worker: Worker;
	try {
		worker = await ready;
	} catch (err) {
		return { ok: false, error: (err as Error).message };
	}
	return new Promise<CalcResult>((resolve) => {
		const done = (result: CalcResult) => {
			clearTimeout(timer);
			worker.terminate();
			resolve(result);
		};
		const timer = setTimeout(
			() =>
				done({
					ok: false,
					error: `stopped after ${TIMEOUT_MS / 1000} s`,
				}),
			TIMEOUT_MS,
		);
		worker.onmessage = (event: MessageEvent<CalcResult>) => done(event.data);
		worker.onerror = (event) =>
			done({ ok: false, error: event.message || "the calculation failed" });
		worker.postMessage(expr);
	});
}

/** A Worker that has loaded mathjs. It doesn't keep the process alive. */
function spawn(): Promise<Worker> {
	const worker = new Worker(new URL("./worker.ts", import.meta.url));
	// Bun's Worker has `unref`; the DOM typings the client needs don't.
	(worker as Worker & { unref(): void }).unref();
	const ready = new Promise<Worker>((resolve, reject) => {
		const fail = (message: string) => {
			clearTimeout(timer);
			worker.terminate();
			reject(new Error(message));
		};
		const timer = setTimeout(
			() => fail("the calculator did not start"),
			STARTUP_MS,
		);
		worker.onmessage = () => {
			clearTimeout(timer);
			resolve(worker);
		};
		worker.onerror = (event) =>
			fail(event.message || "the calculator did not start");
	});
	// A spare nobody takes yet must not surface as an unhandled rejection;
	// the call that takes it awaits the original promise and sees the error.
	ready.catch(() => {});
	return ready;
}
