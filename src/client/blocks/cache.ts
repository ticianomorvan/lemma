/**
 * Renders that take a while (Graphviz, Mermaid, Vega) are promises cached by
 * their input, read with React's `use()`: the block suspends while it renders
 * and the error boundary gets the failure. A streaming answer re-renders many
 * times a second, and the cache is what keeps that from redrawing a diagram.
 */
const MAX = 64;

export function cached<T>(
	cache: Map<string, Promise<T>>,
	key: string,
	make: () => Promise<T>,
): Promise<T> {
	let hit = cache.get(key);
	if (hit) {
		// Refresh its place, so the oldest entry is the least recently used.
		cache.delete(key);
		cache.set(key, hit);
		return hit;
	}
	hit = make();
	cache.set(key, hit);
	if (cache.size > MAX) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	return hit;
}
