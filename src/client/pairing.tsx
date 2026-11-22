/**
 * What a browser without a device cookie sees. The server answers every API
 * route with 403 until the browser opens a one-time `/pair/<code>` link; a
 * used or expired link comes back to this screen at its own path.
 */
import { KeyRound, Link2Off } from "lucide-react";
import { Button, buttonVariants } from "#components/ui/button.tsx";
import { APP_NAME } from "../shared/app.ts";

export const isPairingPath = () => location.pathname.startsWith("/pair/");

export function PairingScreen({
	kind,
	paired,
	onRetry,
}: {
	/** `expired`: a pairing link that was used or timed out. */
	kind: "unpaired" | "expired";
	/** This browser is paired after all (an old link opened again). */
	paired?: boolean;
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
				{paired ? (
					<p className="text-sm leading-relaxed text-pretty">
						Este navegador ya está vinculado, así que podés seguir.
					</p>
				) : (
					<ol className="grid list-decimal gap-2 pl-5 text-sm leading-relaxed text-pretty marker:text-muted-foreground">
						<li>
							Abrí el enlace que {APP_NAME} muestra en la terminal al iniciar
							con <code className="font-mono text-[13px]">bun run start</code>.
						</li>
						<li>
							Si ya tenés otro navegador vinculado, pedí un enlace nuevo desde{" "}
							<span className="font-medium">Dispositivos</span>.
						</li>
					</ol>
				)}
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
							variant: paired ? "default" : "outline",
							className:
								"h-10 transition-transform duration-150 ease-out active:scale-[0.97]",
						})}
					>
						{paired ? `Abrir ${APP_NAME}` : "Volver"}
					</a>
				)}
			</section>
		</main>
	);
}
