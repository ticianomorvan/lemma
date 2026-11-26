import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { APP_NAME } from "../../shared/app.ts";

/**
 * "Hay una versión nueva": shown once a new build's service worker is waiting
 * (register.ts). It asks rather than reloading by itself, since a reload would
 * drop a message being typed. It mounts in its own root from the worker's lazy
 * chunk, so the first load carries none of it.
 */
let root: Root | undefined;

/** Shows the pill, or gives the one showing a new action. */
export function showUpdate(apply: () => void) {
	if (!root) {
		const host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
	}
	root.render(<UpdatePill key={Math.random()} apply={apply} />);
}

function UpdatePill({ apply }: { apply: () => void }) {
	const [busy, setBusy] = useState(false);
	return (
		<div
			role="status"
			className="turn-in fixed top-[60px] left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card py-1 pr-1 pl-3 text-xs whitespace-nowrap text-muted-foreground shadow-sm print:hidden"
		>
			Hay una versión nueva de {APP_NAME}
			<button
				type="button"
				disabled={busy}
				onClick={() => {
					setBusy(true);
					apply();
				}}
				className="h-6 rounded-full bg-primary px-2.5 font-medium text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60"
			>
				Actualizar
			</button>
		</div>
	);
}
