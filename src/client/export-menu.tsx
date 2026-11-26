/**
 * The header's "Exportar" button: it writes the session as a Typst file and
 * its PDF to `<course>/exports/` (the server builds both, see
 * server/typst/export.ts) and links the result. Loaded lazily, like the mode
 * menu beside it.
 */
import { FileDown, FileText } from "lucide-react";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#components/ui/popover.tsx";
import { cn } from "#lib/utils.ts";
import type { ExportResponse } from "../shared/protocol.ts";
import { fileUrl } from "./photos/photos.tsx";
import { basename } from "./thread/model.ts";

type State =
	| { kind: "idle" }
	| { kind: "busy" }
	| { kind: "done"; result: ExportResponse }
	| { kind: "failed"; message: string };

export default function ExportMenu({
	session,
	course,
	compact,
}: {
	session: string;
	course: string;
	/** A phone: icon only. */
	compact: boolean;
}) {
	const [state, setState] = useState<State>({ kind: "idle" });

	const run = async () => {
		setState({ kind: "busy" });
		const res = await fetch(`/api/sessions/${session}/export`, {
			method: "POST",
		}).catch(() => null);
		if (!res?.ok) {
			return setState({
				kind: "failed",
				message: res
					? `No se pudo exportar (HTTP ${res.status}).`
					: "No hay conexión con el servidor.",
			});
		}
		setState({ kind: "done", result: (await res.json()) as ExportResponse });
	};

	const folder = `${course}/exports/`;
	return (
		<Popover
			onOpenChange={(open) => {
				if (open && state.kind !== "busy") setState({ kind: "idle" });
			}}
		>
			<PopoverTrigger className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted-foreground transition-[transform,color,background-color] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.97] aria-expanded:bg-muted aria-expanded:text-foreground">
				<FileDown aria-hidden className="size-3.5" />
				<span className={cn(compact && "sr-only")}>Exportar</span>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="w-[min(340px,calc(100vw-24px))] gap-0 p-3"
			>
				<h3 className="text-[13.5px] font-medium">Exportar la sesión</h3>
				<p className="mt-1 text-[12.5px] text-muted-foreground text-pretty">
					Guarda la sesión como archivo de Typst y como PDF en{" "}
					<span className="font-mono text-[12px]">{folder}</span>, con las
					fórmulas, los diagramas, las notas y las fotos.
				</p>
				{state.kind === "done" && (
					<div className="mt-3 grid gap-1">
						{state.result.pdf ? (
							<a
								href={fileUrl(state.result.pdf)}
								// `/files/*` answers with a sandboxing CSP, where Chrome won't
								// show a PDF: save it instead.
								download
								className="flex min-w-0 items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-[13px] font-medium text-primary transition-transform duration-150 ease-out active:scale-[0.98]"
							>
								<FileText aria-hidden className="size-3.5 shrink-0" />
								<span className="truncate">{basename(state.result.pdf)}</span>
								<span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
									Descargar
								</span>
							</a>
						) : (
							<p
								role="alert"
								className="rounded-md bg-destructive/10 px-2.5 py-2 text-[12.5px] text-destructive dark:bg-destructive/20"
							>
								El PDF no compiló: {state.result.error}
							</p>
						)}
						<p className="px-0.5 text-xs text-muted-foreground">
							También quedó{" "}
							<span className="font-mono">{basename(state.result.typ)}</span>
							{state.result.pdf
								? ", para editarlo."
								: ", con el texto completo."}
						</p>
					</div>
				)}
				{state.kind === "failed" && (
					<p role="alert" className="mt-3 text-[12.5px] text-destructive">
						{state.message}
					</p>
				)}
				<button
					type="button"
					disabled={state.kind === "busy"}
					onClick={() => void run()}
					className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-70"
				>
					{state.kind === "busy"
						? "Exportando…"
						: state.kind === "done"
							? "Exportar de nuevo"
							: "Exportar a Typst y PDF"}
				</button>
			</PopoverContent>
		</Popover>
	);
}
