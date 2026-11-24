/**
 * The Read view prototype (step 7): the real thread, theme and blocks over a
 * fixture page and session, with the open design details as variants behind
 * the ui skill's picker. Dev only: `bun run dev:client`, then
 * /prototypes/read.html; `bun run preview:prototype` serves a built copy.
 * The production build leaves it out (vite.config.ts, e2e/app.pw.ts).
 *
 * `?v=1..3` picks the variant, `?theme=light|dark` the theme, `?chrome=0`
 * hides the picker for screenshots. Keys: 1–3 and ←/→ switch, R replays.
 */
import "../../globals.css";
import "./read.css";
import {
	StrictMode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createRoot } from "react-dom/client";
import { VARIANTS } from "./variants.ts";
import { Workspace } from "./workspace.tsx";

const params = new URLSearchParams(location.search);
const theme = params.get("theme");
if (theme === "light" || theme === "dark") {
	document.documentElement.dataset.theme = theme;
}

function initial() {
	const v = Number.parseInt(params.get("v") ?? "", 10);
	return v >= 1 && v <= VARIANTS.length ? v - 1 : 0;
}

function Harness() {
	const [current, setCurrent] = useState(initial);
	const [mount, setMount] = useState(0);
	const variant = VARIANTS[current] ?? VARIANTS[0];

	const select = (i: number) => {
		if (i < 0 || i >= VARIANTS.length) return;
		setCurrent(i);
		setMount((m) => m + 1);
		const url = new URL(location.href);
		url.searchParams.set("v", String(i + 1));
		history.replaceState(null, "", url);
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement;
			if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)
				return;
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			const n = Number.parseInt(e.key, 10);
			if (n >= 1 && n <= VARIANTS.length) select(n - 1);
			else if (e.key === "ArrowRight") select((current + 1) % VARIANTS.length);
			else if (e.key === "ArrowLeft")
				select((current - 1 + VARIANTS.length) % VARIANTS.length);
			else if (e.key === "r" || e.key === "R") setMount((m) => m + 1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	return (
		<>
			{variant && <Workspace key={`${current}-${mount}`} variant={variant} />}
			{params.get("chrome") !== "0" && (
				<Picker
					current={current}
					onSelect={select}
					onReplay={() => setMount((m) => m + 1)}
				/>
			)}
		</>
	);
}

/** The ui skill's picker (PICKER.md), as React. */
function Picker({
	current,
	onSelect,
	onReplay,
}: {
	current: number;
	onSelect: (i: number) => void;
	onReplay: () => void;
}) {
	const nav = useRef<HTMLElement>(null);
	const highlight = useRef<HTMLSpanElement>(null);
	const items = useRef<(HTMLButtonElement | null)[]>([]);
	const [ready, setReady] = useState(false);
	// Every variant fills the bottom edge on a phone (composer, strip, tab bar).
	const [top, setTop] = useState(
		() => matchMedia("(max-width: 639px)").matches,
	);

	useLayoutEffect(() => {
		const move = () => {
			const el = items.current[current];
			if (!el || !highlight.current) return;
			highlight.current.style.width = `${el.offsetWidth}px`;
			highlight.current.style.transform = `translateX(${el.offsetLeft}px)`;
			setTop(matchMedia("(max-width: 639px)").matches);
		};
		move();
		window.addEventListener("resize", move);
		return () => window.removeEventListener("resize", move);
	}, [current]);

	useEffect(() => {
		const f = requestAnimationFrame(() =>
			requestAnimationFrame(() => setReady(true)),
		);
		return () => cancelAnimationFrame(f);
	}, []);

	return (
		<nav
			ref={nav}
			className="proto-picker"
			aria-label="Prototype variants"
			data-ready={ready || undefined}
			data-position={top ? "top" : undefined}
		>
			<span
				ref={highlight}
				className="proto-picker-highlight"
				aria-hidden="true"
			/>
			{VARIANTS.map((v, i) => (
				<button
					key={v.name}
					ref={(el) => {
						items.current[i] = el;
					}}
					type="button"
					className="proto-picker-item"
					data-active={i === current || undefined}
					aria-current={i === current ? "true" : undefined}
					onClick={() => onSelect(i)}
				>
					{v.name}
				</button>
			))}
			<span className="proto-picker-divider" aria-hidden="true" />
			<button
				type="button"
				className="proto-picker-item proto-picker-replay"
				aria-label="Replay animation (R)"
				onClick={onReplay}
			>
				↻
			</button>
		</nav>
	);
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<Harness />
		</StrictMode>,
	);
}
