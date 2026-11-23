/**
 * One fenced diagram block in an answer, on its Tarjeta card. Each kind's
 * renderer is its own lazy chunk. A block whose fence hasn't closed shows its
 * source (it's still streaming in); a block that fails to parse or render
 * shows its source with the error, so a mistake never takes the answer down
 * with it.
 */
import "./blocks.css";
import { Code2 } from "lucide-react";
import {
	Component,
	type ComponentType,
	lazy,
	type ReactNode,
	Suspense,
	useLayoutEffect,
	useState,
} from "react";
import { cn } from "#lib/utils.ts";
import { BLOCK_KINDS, type BlockKind } from "./kinds.ts";

type Renderer = ComponentType<{ source: string }>;

const RENDERERS: Record<BlockKind, Renderer> = {
	dot: lazy(() => import("./dot.tsx")),
	proof: lazy(() => import("./proof.tsx")),
	fitch: lazy(() => import("./fitch.tsx")),
	plot: lazy(() => import("./plot.tsx")),
	"vega-lite": lazy(() => import("./vega-lite.tsx")),
	mermaid: lazy(() => import("./mermaid.tsx")),
};

type State = "ok" | "error" | "pending" | "loading";

export function DiagramBlock({
	kind,
	source,
	open,
}: {
	kind: BlockKind;
	source: string;
	/** The closing fence hasn't arrived yet. */
	open?: boolean;
}) {
	const [state, setState] = useState<State>(open ? "pending" : "loading");
	const [showSource, setShowSource] = useState(false);
	const { label, maxSource } = BLOCK_KINDS[kind];
	const Renderer = RENDERERS[kind];
	const failure = (error: Error) => (
		<Report state="error" set={setState}>
			<p className="block-error" role="alert">
				<span className="font-medium">No se pudo dibujar:</span> {error.message}
			</p>
			<pre className="block-source">{source}</pre>
		</Report>
	);
	let body: ReactNode;
	if (open) {
		body = (
			<Report state="pending" set={setState}>
				<pre className="block-source">{source || " "}</pre>
			</Report>
		);
	} else if (source.length > maxSource) {
		body = failure(
			new Error(`el bloque es demasiado largo (máx. ${maxSource} caracteres)`),
		);
	} else {
		body = (
			<Boundary key={source} fallback={failure}>
				<Suspense
					fallback={
						<Report state="loading" set={setState}>
							<div className="block-loading" />
						</Report>
					}
				>
					<Report state="ok" set={setState}>
						<Renderer source={source} />
					</Report>
				</Suspense>
			</Boundary>
		);
	}
	return (
		<figure className="block" data-block={kind} data-state={state}>
			<figcaption className="block-head">
				<span className={cn("block-chip", state === "error" && "is-error")}>
					{label}
				</span>
				{state === "pending" && (
					<span className="thinking-shimmer">Escribiendo…</span>
				)}
				{state === "ok" && (
					<button
						type="button"
						className="block-toggle"
						aria-pressed={showSource}
						onClick={() => setShowSource((v) => !v)}
					>
						<Code2 aria-hidden className="size-3.5" />
						Fuente
					</button>
				)}
			</figcaption>
			<div className="block-body">{body}</div>
			{state === "ok" && showSource && (
				<pre className="block-source">{source}</pre>
			)}
		</figure>
	);
}

/** Renders its children and tells the card which state is showing. */
function Report({
	state,
	set,
	children,
}: {
	state: State;
	set: (s: State) => void;
	children: ReactNode;
}) {
	useLayoutEffect(() => set(state), [state, set]);
	return children;
}

class Boundary extends Component<
	{ fallback: (error: Error) => ReactNode; children: ReactNode },
	{ error: Error | null }
> {
	override state = { error: null as Error | null };
	static getDerivedStateFromError(error: unknown) {
		return { error: error instanceof Error ? error : new Error(String(error)) };
	}
	override render() {
		return this.state.error
			? this.props.fallback(this.state.error)
			: this.props.children;
	}
}
