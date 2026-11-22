/**
 * First run: asks where the study folder is. The server makes it if needed and
 * keeps it in config.json, so this shows once.
 */
import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { Label } from "#components/ui/label.tsx";
import { APP_NAME } from "../shared/app.ts";
import type { SetFolderBody } from "../shared/protocol.ts";

/** Server error codes, in the words the screen uses. */
const ERRORS: Record<string, string> = {
	bad_request: "Escribí la ruta completa, por ejemplo ~/Estudio.",
	too_broad:
		"Elegí una carpeta dentro de tu carpeta personal, no la carpeta entera.",
	not_a_folder: "Esa ruta no es una carpeta que Lemma pueda usar.",
	folder_set: "La carpeta ya estaba elegida. Recargá la página.",
};

export function FolderSetup({ onDone }: { onDone: () => void }) {
	const [path, setPath] = useState("~/Estudio");
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError(undefined);
		try {
			const res = await fetch("/api/folder", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path } satisfies SetFolderBody),
			});
			if (res.ok) return onDone();
			const body = (await res.json().catch(() => ({}))) as {
				error?: { code?: string };
			};
			setError(
				ERRORS[body.error?.code ?? ""] ?? "No se pudo usar esa carpeta.",
			);
		} catch {
			setError("No se pudo conectar con el servidor de Lemma.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<main className="grid min-h-dvh place-items-center bg-paper px-4 py-10">
			<form
				onSubmit={submit}
				className="turn-in grid w-full max-w-[440px] gap-6 rounded-xl border bg-card p-6 shadow-sm sm:p-8"
			>
				<div className="grid gap-3">
					<span className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary">
						<FolderOpen aria-hidden className="size-5" />
					</span>
					<h1 className="font-heading text-2xl leading-tight font-semibold text-balance">
						Elegí tu carpeta de estudio
					</h1>
					<p className="text-sm leading-relaxed text-muted-foreground text-pretty">
						{APP_NAME} guarda cada sesión como un archivo Markdown en esta
						carpeta, y Claude lee tus apuntes desde ahí. Cada carpeta de primer
						nivel es una materia. Si no existe, la creamos.
					</p>
				</div>
				<div className="grid gap-2">
					<Label htmlFor="study-folder">Carpeta</Label>
					<Input
						id="study-folder"
						value={path}
						onChange={(e) => setPath(e.target.value)}
						autoComplete="off"
						spellCheck={false}
						aria-invalid={error ? true : undefined}
						aria-describedby={error ? "study-folder-error" : undefined}
						className="h-10 font-mono"
					/>
					{error ? (
						<p
							id="study-folder-error"
							role="alert"
							className="text-sm text-destructive"
						>
							{error}
						</p>
					) : (
						<p className="text-xs text-muted-foreground">
							Por ejemplo <code className="font-mono">~/Estudio</code> o{" "}
							<code className="font-mono">~/Documents/Facultad</code>.
						</p>
					)}
				</div>
				<Button
					type="submit"
					size="lg"
					disabled={busy || !path.trim()}
					className="h-10 transition-transform duration-150 ease-out active:scale-[0.97]"
				>
					{busy ? "Preparando…" : "Usar esta carpeta"}
				</Button>
			</form>
		</main>
	);
}
