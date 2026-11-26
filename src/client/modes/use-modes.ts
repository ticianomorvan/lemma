/**
 * The study modes the folder offers (`GET /api/state` → `modes`), and the
 * session's mode with a way to change it (`PATCH /api/sessions/:id`). The
 * change shows at once; the server's `meta` event, which every client gets,
 * confirms it.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type {
	Mode,
	SessionMeta,
	StateResponse,
} from "../../shared/protocol.ts";

let modes: Mode[] = [];
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();

/** Asks the server again (once per call), e.g. after the folder changed. */
export function refreshModes() {
	loading = fetch("/api/state")
		.then((res) => (res.ok ? (res.json() as Promise<StateResponse>) : null))
		.then((state) => {
			if (!state) return;
			modes = state.modes;
			for (const l of listeners) l();
		})
		.catch(() => {});
	return loading;
}

export function useModes(): Mode[] {
	useEffect(() => {
		// None yet (or a folder chosen since): ask again.
		if (!loading || modes.length === 0) void refreshModes();
	}, []);
	return useSyncExternalStore(
		(l) => {
			listeners.add(l);
			return () => listeners.delete(l);
		},
		() => modes,
	);
}

/**
 * The session's mode as this client should show it: the one just picked
 * until the server confirms it (or refuses it), else the front matter's.
 */
export function useSessionMode(meta: SessionMeta | undefined) {
	const [picked, setPicked] = useState<{ mode: string | null }>();
	const confirmed = meta?.mode ?? null;
	useEffect(() => {
		if (picked && picked.mode === confirmed) setPicked(undefined);
	}, [picked, confirmed]);
	const id = meta?.id;
	const choose = useCallback(
		(mode: string | null) => {
			if (!id) return;
			setPicked({ mode });
			void fetch(`/api/sessions/${id}`, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ mode }),
			})
				.then((res) => {
					if (!res.ok) setPicked(undefined);
				})
				.catch(() => setPicked(undefined));
		},
		[id],
	);
	return { mode: picked ? picked.mode : confirmed, choose };
}
