/**
 * What a browser without a device cookie sees. The server answers every API
 * route with 403 until the browser opens a one-time `/pair/<code>` link; a
 * used or expired link comes back to this screen at its own path.
 *
 * Opening the link only loads the page: the page redeems the code with a
 * POST, so whatever fetches a link without running it (a chat app's preview,
 * a prefetch) can't spend it, and a prerendered page waits until it shows.
 */
import { KeyRound, Link2Off, WifiOff } from "lucide-react";
import { Button, buttonVariants } from "#components/ui/button.tsx";
import { APP_NAME } from "../shared/app.ts";
import type { RedeemResponse } from "../shared/protocol.ts";

export const isPairingPath = () => location.pathname.startsWith("/pair/");

let redeeming: Promise<string | null> | undefined;

/**
 * Redeems this page's pairing link: where to go next (the cookie is set), or
 * null when the link was used or expired and this browser isn't paired.
 * Throws when the server can't be reached, so the code is still good. One
 * POST per page load, however often it's asked (StrictMode runs effects
 * twice in dev, and the second POST would find the code spent).
 */
export function redeemLink(): Promise<string | null> {
	redeeming ??= redeem().catch((error) => {
		redeeming = undefined;
		throw error;
	});
	return redeeming;
}

async function redeem() {
	const doc = document as Document & { prerendering?: boolean };
	if (doc.prerendering) {
		await new Promise((resolve) =>
			doc.addEventListener("prerenderingchange", resolve, { once: true }),
		);
	}
	const res = await fetch(location.pathname + location.search, {
		method: "POST",
	});
	if (res.status === 403) return null;
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return ((await res.json()) as RedeemResponse).next;
}

const COPY = {
	unpaired: {
		Icon: KeyRound,
		title: "Vinculá este navegador",
		text: `${APP_NAME} solo responde a navegadores vinculados, para que ningún otro programa de tu computadora pueda usar tu carpeta de estudio.`,
	},
	expired: {
		Icon: Link2Off,
		title: "Este enlace ya no sirve",
		text: "Cada enlace para vincular sirve una sola vez y vence a los 5 minutos.",
	},
	offline: {
		Icon: WifiOff,
		title: "No se pudo vincular",
		text: `${APP_NAME} no respondió. Revisá que este dispositivo esté en la misma red Wi-Fi que la computadora y que ${APP_NAME} siga abierto. El enlace todavía sirve.`,
	},
};

export function PairingScreen({
	kind,
	onRetry,
}: {
	/**
	 * `expired`: a pairing link that was used or timed out. `offline`: one
	 * whose redemption never reached the server.
	 */
	kind: keyof typeof COPY;
	/** For `unpaired` and `offline`: try again. */
	onRetry?: () => void;
}) {
	const { Icon, title, text } = COPY[kind];
	return (
		<main className="grid min-h-dvh place-items-center bg-paper px-4 py-10">
			<section
				aria-labelledby="pairing-title"
				className="turn-in grid w-full max-w-[440px] gap-6 rounded-xl border bg-card p-6 shadow-sm sm:p-8"
			>
				<div className="grid gap-3">
					<span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary">
						<Icon aria-hidden className="size-5" />
					</span>
					<h1
						id="pairing-title"
						className="font-heading text-2xl leading-tight font-semibold text-balance"
					>
						{title}
					</h1>
					<p className="text-sm leading-relaxed text-muted-foreground text-pretty">
						{text}
					</p>
				</div>
				{kind !== "offline" && (
					<ol className="grid list-decimal gap-2 pl-5 text-sm leading-relaxed text-pretty marker:text-muted-foreground">
						<li>
							Abrí el enlace que {APP_NAME} muestra en la terminal al iniciar
							con <code className="font-mono text-[13px]">bun run start</code>.
						</li>
						<li>
							Si ya tenés otro navegador vinculado, pedí un enlace nuevo desde{" "}
							<span className="font-medium">Dispositivos</span>.
						</li>
						<li>
							Para un teléfono, escaneá un código QR nuevo: en la computadora,
							hacé clic en el ícono del teléfono junto al mensaje.
						</li>
					</ol>
				)}
				{kind !== "expired" ? (
					<Button
						size="lg"
						variant="outline"
						onClick={onRetry}
						className="h-10 transition-transform duration-150 ease-out active:scale-[0.97]"
					>
						{kind === "offline" ? "Reintentar" : "Ya lo abrí, reintentar"}
					</Button>
				) : (
					<a
						href="/"
						className={buttonVariants({
							size: "lg",
							variant: "outline",
							className:
								"h-10 transition-transform duration-150 ease-out active:scale-[0.97]",
						})}
					>
						Volver
					</a>
				)}
			</section>
		</main>
	);
}
