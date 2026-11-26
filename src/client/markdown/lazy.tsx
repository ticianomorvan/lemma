/**
 * The Markdown renderer (react-markdown, KaTeX and the diagram blocks) is
 * its own chunk, so the app shell paints before it arrives. The import
 * starts as soon as this module loads; until it lands, or if it can't load
 * (offline, or a deploy replaced the chunk), text shows as is.
 */
import { Component, lazy, type ReactNode, Suspense } from "react";

const load = import("./markdown.tsx");
const Lazy = lazy(() => load.then((m) => ({ default: m.Markdown })));
const LazyTitle = lazy(() => load.then((m) => ({ default: m.TitleText })));

/** `plainTitle` (shared/title.ts) once this chunk is here, so it stays out of the first load. */
let plainTitle: ((title: string) => string) | undefined;
load.then(
	(m) => {
		plainTitle = m.plainTitle;
	},
	() => {},
);

/**
 * A session's title, with its inline math rendered; plain text until the
 * renderer arrives, or if it can't load. An empty title reads "Sin título".
 */
export function Title({ title }: { title: string }) {
	if (!title) return "Sin título";
	const plain = titleText(title);
	return (
		<PlainOnError fallback={plain}>
			<Suspense fallback={plain}>
				<LazyTitle title={title} />
			</Suspense>
		</PlainOnError>
	);
}

/**
 * A title as plain text, for a tooltip, a tab or a file name. Before the
 * renderer's chunk arrives (it starts loading with the app), only the `$`
 * are dropped.
 */
export const titleText = (title: string) =>
	(plainTitle ? plainTitle(title) : title.replace(/\$/g, "")) || "Sin título";

export function Markdown(props: { text: string; question?: boolean }) {
	const plain = (loading?: boolean) => (
		<p className="whitespace-pre-wrap" data-pending={loading || undefined}>
			{props.text}
		</p>
	);
	return (
		<PlainOnError fallback={plain()}>
			<Suspense fallback={plain(true)}>
				<Lazy {...props} />
			</Suspense>
		</PlainOnError>
	);
}

class PlainOnError extends Component<
	{ fallback: ReactNode; children: ReactNode },
	{ failed: boolean }
> {
	override state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	override render() {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}
