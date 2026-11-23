/**
 * The calc Worker: loads the locked mathjs instance, says it is ready, then
 * evaluates the one expression it is sent. `calc.ts` kills it after that call
 * or after 1 s, whichever comes first.
 */
import { run } from "./engine.ts";

declare const self: Worker;

self.onmessage = (event: MessageEvent<string>) => {
	postMessage(run(event.data));
};
postMessage("ready");
