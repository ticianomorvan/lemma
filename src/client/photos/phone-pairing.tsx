/**
 * The QR panel of "Foto desde el teléfono" (phone-popover.tsx, which loads it
 * lazily with the QR encoder): a code that pairs a phone over the LAN and
 * opens this session on it. The code is asked for when the panel opens and
 * again when it runs out.
 */
import { Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
	DevicesResponse,
	ErrorResponse,
	PairResponse,
} from "../../shared/protocol.ts";
import { isUnpaired } from "../unpaired.ts";
import { Qr } from "./qr.tsx";

type Link = PairResponse | { error: string };

export default function PhonePairing({
	session,
	onUnpaired,
}: {
	/** The session the phone opens once paired. */
	session?: string;
	/** This browser was unpaired meanwhile. */
	onUnpaired?: () => void;
}) {
	const [link, setLink] = useState<Link>();
	const [phones, setPhones] = useState<string[]>();

	const ask = useCallback(async () => {
		const res = await fetch("/api/pair", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ lan: true }),
		}).catch(() => null);
		if (res && (await isUnpaired(res))) return onUnpaired?.();
		if (!res?.ok) {
			const body = (await res
				?.json()
				.catch(() => null)) as ErrorResponse | null;
			return setLink({
				error:
					body?.error.code === "no_lan"
						? "Esta computadora no está conectada a una red Wi-Fi o local."
						: "No se pudo crear el código.",
			});
		}
		const pair = (await res.json()) as PairResponse;
		const url = session
			? `${pair.url}?next=${encodeURIComponent(`/s/${session}`)}`
			: pair.url;
		setLink({ ...pair, url });
	}, [session, onUnpaired]);

	useEffect(() => {
		void ask();
		void fetch("/api/devices")
			.then((res) => (res.ok ? (res.json() as Promise<DevicesResponse>) : null))
			.then((list) =>
				setPhones(list?.devices.filter((d) => d.lan).map((d) => d.name) ?? []),
			)
			.catch(() => {});
	}, [ask]);

	// A new code when this one runs out, while the panel is open.
	const expiresAt = link && "expiresAt" in link ? link.expiresAt : undefined;
	useEffect(() => {
		if (!expiresAt) return;
		const timer = setTimeout(
			() => void ask(),
			Math.max(0, Date.parse(expiresAt) - Date.now()),
		);
		return () => clearTimeout(timer);
	}, [expiresAt, ask]);

	return (
		<div className="grid gap-3">
			<div className="grid gap-1">
				<h3 className="font-heading text-[17px] leading-tight font-semibold">
					Mandá fotos desde el teléfono
				</h3>
				<p className="text-[13px] leading-snug text-muted-foreground text-pretty">
					Escaneá el código con la cámara del teléfono, conectado a la misma red
					Wi-Fi. Se abre esta sesión y las fotos llegan acá.
				</p>
			</div>
			<div className="mx-auto w-full max-w-[220px]">
				{link === undefined ? (
					<div className="aspect-square w-full animate-pulse rounded-md bg-muted" />
				) : "error" in link ? (
					<p
						role="alert"
						className="grid aspect-square place-content-center rounded-md border border-dashed p-4 text-center text-[13px] text-muted-foreground text-pretty"
					>
						{link.error}
					</p>
				) : (
					<Qr text={link.url} label="Código QR para vincular el teléfono" />
				)}
			</div>
			{link && "expiresAt" in link && (
				<p className="text-center text-xs text-muted-foreground">
					Sirve una vez · se renueva a las{" "}
					<time dateTime={link.expiresAt}>{shortTime(link.expiresAt)}</time>
				</p>
			)}
			{phones && phones.length > 0 && (
				<p className="flex items-center gap-2 rounded-md bg-secondary px-2.5 py-2 text-[13px]">
					<Smartphone aria-hidden className="size-3.5 shrink-0 text-success" />
					<span className="min-w-0 truncate">
						Vinculado: {phones.join(", ")}
					</span>
				</p>
			)}
		</div>
	);
}

const shortTime = (iso: string) =>
	new Date(iso).toLocaleTimeString("es", {
		hour: "2-digit",
		minute: "2-digit",
	});
