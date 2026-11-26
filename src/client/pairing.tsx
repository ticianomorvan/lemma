/**
 * What a browser without a device cookie sees. The server answers every API
 * route with 403 until the browser opens a one-time `/pair/<code>` link; a
 * used or expired link comes back to this screen at its own path.
 *
 * Opening the link only loads the page: the page redeems the code with a
 * POST, so whatever fetches a link without running it (a chat app's preview,
 * a prefetch) can't spend it, and a prerendered page waits until it shows.
 */
import { KeyRound, Link2Off } from "lucide-react";
import { Button, buttonVariants } from "#components/ui/button.tsx";
import { APP_NAME } from "../shared/app.ts";
import type { RedeemResponse } from "../shared/protocol.ts";

export const isPairingPath = () => location.pathname.startsWith("/pair/");

/**
 * Redeems this page's pairing link: where to go next (the cookie is set), or
 * null when the link was used or expired and this browser isn't paired.
 */
export async function redeemLink(): Promise<string | null> {
	const doc = document as Document & { prerendering?: boolean };
	if (doc.prerendering) {
		await new Promise((resolve) =>
			doc.addEventListener("prerenderingchange", resolve, { once: true }),
		);
	}
	const res = await fetch(location.pathname + location.search, {
		method: "POST",
	}).catch(() => null);
	if (!res?.ok) return null;
	return ((await res.json()) as RedeemResponse).next;
}

export function PairingScreen({
	kind,
	onRetry,
}: {
	/** `expired`: a pairing link that was used or timed out. */
	kind: "unpaired" | "expired";
	/** For `unpaired`: check again, after pairing in another tab. */
	onRetry?: () => void;
}) {
	const expired = kind === "expired";
	const Icon = expired ? Link2Off : KeyRound;
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
						{expired ? "Este enlace ya no sirve" : "Vinculá este navegador"}
					</h1>
					<p className="text-sm leading-relaxed text-muted-foreground text-pretty">
						{expired
							? "Cada enlace para vincular sirve una sola vez y vence a los 5 minutos."
							: `${APP_NAME} solo responde a navegadores vinculados, para que ningún otro programa de tu computadora pueda usar tu carpeta de estudio.`}
					</p>
				</div>
				<ol className="grid list-decimal gap-2 pl-5 text-sm leading-relaxed text-pretty marker:text-muted-foreground">
					<li>
						Abrí el enlace que {APP_NAME} muestra en la terminal al iniciar con{" "}
						<code className="font-mono text-[13px]">bun run start</code>.
					</li>
					<li>
						Si ya tenés otro navegador vinculado, pedí un enlace nuevo desde{" "}
						<span className="font-medium">Dispositivos</span>.
					</li>
				</ol>
				{kind === "unpaired" ? (
					<Button
						size="lg"
						variant="outline"
						onClick={onRetry}
						className="h-10 transition-transform duration-150 ease-out active:scale-[0.97]"
					>
						Ya lo abrí, reintentar
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
