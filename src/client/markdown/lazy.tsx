/**
 * The Markdown renderer (react-markdown, KaTeX and the diagram blocks) is
 * its own chunk, so the app shell paints before it arrives. The import
 * starts as soon as this module loads; until it lands, text shows as is.
 */
import { lazy, Suspense } from "react";

const load = import("./markdown.tsx");
const Lazy = lazy(() => load.then((m) => ({ default: m.Markdown })));

export function Markdown(props: { text: string; question?: boolean }) {
	return (
		<Suspense fallback={<p className="whitespace-pre-wrap">{props.text}</p>}>
			<Lazy {...props} />
		</Suspense>
	);
}
