import "./globals.css";
// Copying rendered math copies its LaTeX source.
import "katex/contrib/copy-tex";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
