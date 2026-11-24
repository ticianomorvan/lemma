/**
 * The Read view prototype (step 7): the real thread, theme and blocks over a
 * fixture page and session, in the design chosen for step 8 (docs/architecture.md
 * → Views). Dev only: `bun run dev:client`, then /prototypes/read.html;
 * `bun run preview:prototype` serves a built copy. The production build leaves
 * it out (vite.prototype.config.ts, e2e/app.pw.ts). `?theme=light|dark` sets the theme.
 */
import "../../globals.css";
import "./read.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "./workspace.tsx";

const theme = new URLSearchParams(location.search).get("theme");
if (theme === "light" || theme === "dark") {
	document.documentElement.dataset.theme = theme;
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<Workspace />
		</StrictMode>,
	);
}
