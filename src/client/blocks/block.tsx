/**
 * One fenced diagram block in an answer. Each kind's renderer is its own lazy
 * chunk. A block whose fence hasn't closed shows its source (it's still
 * streaming in); a block that fails to parse or render shows its source with
 * the error, so a mistake never takes the answer down with it.
 */
import "./blocks.css";
import { Code2 } from "lucide-react";
import {
	Component,
	type ComponentType,
	lazy,
	type ReactNode,
	Suspense,
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
	if (open) {
		return (
			<Frame kind={kind} state="pending" source={source}>
				<pre className="block-source">{source || " "}</pre>
			</Frame>
		);
	}
	const Renderer = RENDERERS[kind];
	return (
		<Boundary
			key={source}
			fallback={(error) => (
				<Frame kind={kind} state="error" source={source}>
					<p className="block-error" role="alert">
						<span className="font-medium">No se pudo dibujar:</span>{" "}
						{error.message}
					</p>
					<pre className="block-source">{source}</pre>
				</Frame>
			)}
		>
			<Suspense
				fallback={
					<Frame kind={kind} state="loading" source={source}>
						<div className="block-loading" />
					</Frame>
				}
			>
				<Frame kind={kind} state="ok" source={source}>
					<Renderer source={source} />
				</Frame>
			</Suspense>
		</Boundary>
	);
}

/** The Tarjeta card every block sits on: a label, the body, and its source on demand. */
function Frame({
	kind,
	state,
	source,
	children,
}: {
	kind: BlockKind;
	state: State;
	source: string;
	children: ReactNode;
}) {
	const [showSource, setShowSource] = useState(false);
	const canToggle = state === "ok";
	return (
		<figure className="block" data-block={kind} data-state={state}>
			<figcaption className="block-head">
				<span className={cn("block-chip", state === "error" && "is-error")}>
					{BLOCK_KINDS[kind]}
				</span>
				{state === "pending" && (
					<span className="thinking-shimmer">Escribiendo…</span>
				)}
				{canToggle && (
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
			<div className="block-body">{children}</div>
			{canToggle && showSource && <pre className="block-source">{source}</pre>}
		</figure>
	);
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
