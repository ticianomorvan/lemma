/**
 * The Markdown renderer (react-markdown, KaTeX and the diagram blocks) is
 * its own chunk, so the app shell paints before it arrives. The import
 * starts as soon as this module loads; until it lands, or if it can't load
 * (offline, or a deploy replaced the chunk), text shows as is.
 */
import { Component, lazy, type ReactNode, Suspense } from "react";

const load = import("./markdown.tsx");
const Lazy = lazy(() => load.then((m) => ({ default: m.Markdown })));

export function Markdown(props: { text: string; question?: boolean }) {
	const plain = (loading?: boolean) => (
		<p className="whitespace-pre-wrap" data-md-loading={loading || undefined}>
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
