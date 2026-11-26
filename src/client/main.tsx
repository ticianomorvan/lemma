import "./zod-config.ts";
import "./globals.css";
// Copying rendered math copies its LaTeX source.
import "katex/contrib/copy-tex";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

// The installable app's service worker, from its own chunk once the page has
// loaded, so the first load stays the same. Only secure contexts have service
// workers: the desktop on 127.0.0.1 or localhost, never a phone over plain
// LAN HTTP, which gets no worker and no install. Dev has none.
if (
	import.meta.env.PROD &&
	window.isSecureContext &&
	"serviceWorker" in navigator
) {
	window.addEventListener("load", () => void import("./pwa/register.ts"), {
		once: true,
	});
}
