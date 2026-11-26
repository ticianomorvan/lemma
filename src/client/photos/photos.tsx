/**
 * Photos in the composer: the camera button, and the strip of photos waiting
 * for the next message. Waiting photos are the session's (every client sees
 * them, wherever they were taken); uploads show from their local copy until
 * the server lists them.
 */
import { Camera, LoaderCircle, X } from "lucide-react";
import { useRef } from "react";
import { cn } from "#lib/utils.ts";
import type { Attachment } from "../../shared/protocol.ts";
import type { Upload } from "../store.ts";

/** `/files/` URL of a root-relative path. */
export const fileUrl = (path: string) =>
	`/files/${path.split("/").map(encodeURIComponent).join("/")}`;

/**
 * Opens the camera on a phone (`capture=environment`, the back camera); on a
 * computer the same input opens a file picker.
 */
export function CameraButton({
	onPhotos,
	variant,
	label = "Sacar foto",
	className,
}: {
	onPhotos: (files: File[]) => void;
	/** `icon` beside the composer; `hero` in an empty notebook; `tile` after the strip's photos. */
	variant: "icon" | "hero" | "tile";
	label?: string;
	className?: string;
}) {
	const input = useRef<HTMLInputElement>(null);
	return (
		<>
			<input
				ref={input}
				type="file"
				accept="image/*"
				capture="environment"
				className="sr-only"
				tabIndex={-1}
				aria-hidden
				data-camera
				onChange={(e) => {
					const files = [...(e.currentTarget.files ?? [])];
					// Cleared so the same photo can be picked again.
					e.currentTarget.value = "";
					if (files.length > 0) onPhotos(files);
				}}
			/>
			<button
				type="button"
				onClick={() => input.current?.click()}
				aria-label={variant === "icon" ? label : undefined}
				className={cn(
					"inline-flex shrink-0 select-none items-center justify-center transition-transform duration-150 ease-out [-webkit-touch-callout:none] active:scale-[0.96]",
					variant === "icon" &&
						"size-11 rounded-full bg-primary-soft text-primary dark:bg-primary/20",
					variant === "hero" &&
						"h-12 gap-2 rounded-full bg-primary px-6 text-[15px] font-medium text-primary-foreground shadow-sm",
					variant === "tile" &&
						"size-16 flex-col gap-1 rounded-lg border border-dashed text-[11px] text-muted-foreground",
					className,
				)}
			>
				<Camera
					aria-hidden
					className={variant === "tile" ? "size-4" : "size-5"}
				/>
				{variant !== "icon" && label}
			</button>
		</>
	);
}

export function PhotoStrip({
	waiting,
	uploads,
	onDrop,
	onDismiss,
	more,
}: {
	waiting: Attachment[];
	uploads: Upload[];
	onDrop: (id: string) => void;
	onDismiss: (key: string) => void;
	/** "Sacar otra", after the photos (on a phone). */
	more?: React.ReactNode;
}) {
	// An upload the server already lists shows once, as the waiting photo.
	const listed = new Set(waiting.map((a) => a.id));
	const local = uploads.filter((u) => !u.id || !listed.has(u.id));
	if (waiting.length === 0 && local.length === 0) return null;
	return (
		<ul
			aria-label="Fotos por enviar"
			className="-mx-1 flex gap-2 overflow-x-auto px-1 pt-1 pb-0.5"
		>
			{waiting.map((a, i) => (
				<li key={a.id} className="turn-in relative shrink-0">
					<img
						src={fileUrl(a.path)}
						alt={`Foto ${i + 1}`}
						className="size-16 rounded-lg border object-cover"
					/>
					<button
						type="button"
						onClick={() => onDrop(a.id)}
						aria-label={`Quitar la foto ${i + 1}`}
						className="absolute -top-1.5 -right-1.5 grid size-6 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm transition-transform duration-150 ease-out active:scale-[0.9]"
					>
						<X aria-hidden className="size-3.5" />
					</button>
				</li>
			))}
			{local.map((u) => (
				<li
					key={u.key}
					className="relative shrink-0"
					data-uploading={u.failed ? undefined : ""}
				>
					{u.preview ? (
						<img
							src={u.preview}
							alt=""
							className={cn(
								"size-16 rounded-lg border object-cover",
								!u.failed && "opacity-60",
							)}
						/>
					) : (
						<span className="block size-16 rounded-lg border bg-muted" />
					)}
					{u.failed ? (
						<button
							type="button"
							onClick={() => onDismiss(u.key)}
							title={u.failed}
							aria-label={`No se pudo subir: ${u.failed}. Quitar`}
							className="absolute inset-0 grid place-items-center rounded-lg bg-destructive/70 text-white"
						>
							<X aria-hidden className="size-4" />
						</button>
					) : (
						<span
							role="status"
							aria-label="Subiendo foto"
							className="absolute inset-0 grid place-items-center"
						>
							<LoaderCircle
								aria-hidden
								className="size-5 animate-spin text-foreground"
							/>
						</span>
					)}
				</li>
			))}
			{more && <li className="shrink-0">{more}</li>}
		</ul>
	);
}

/** A question's photos, in its card. */
export function SentPhotos({ photos }: { photos: Attachment[] }) {
	if (photos.length === 0) return null;
	return (
		<div className="mb-2 flex flex-wrap gap-2">
			{photos.map((a, i) => (
				<a
					key={a.id}
					href={fileUrl(a.path)}
					target="_blank"
					rel="noreferrer"
					className="block overflow-hidden rounded-lg border transition-transform duration-150 ease-out active:scale-[0.98]"
				>
					<img
						src={fileUrl(a.path)}
						alt={`Foto ${i + 1} de la pregunta`}
						loading="lazy"
						className="max-h-56 w-auto max-w-full object-contain"
					/>
				</a>
			))}
		</div>
	);
}
