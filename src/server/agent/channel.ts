/** A push-to-pull queue: values pushed now are read later with `for await`. */
export function channel<T>() {
	const buffer: T[] = [];
	let wake: (() => void) | null = null;
	let ended = false;
	const notify = () => {
		wake?.();
		wake = null;
	};
	return {
		push(value: T) {
			if (ended) return;
			buffer.push(value);
			notify();
		},
		end() {
			ended = true;
			notify();
		},
		async *[Symbol.asyncIterator](): AsyncGenerator<T, void> {
			while (true) {
				const next = buffer.shift();
				if (next !== undefined) yield next;
				else if (ended) return;
				else await new Promise<void>((resolve) => (wake = resolve));
			}
		},
	};
}
