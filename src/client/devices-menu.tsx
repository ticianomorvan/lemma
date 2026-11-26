/**
 * The header's device list: every paired browser, unpairing one (two clicks),
 * and a one-time link to pair another. It reads the list fresh each time it
 * opens. A phone pairs from the composer's QR code instead (photos/phone-popover.tsx), over the LAN; it shows here marked "por Wi-Fi".
 */
import { Check, Copy, MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { Input } from "#components/ui/input.tsx";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#components/ui/popover.tsx";
import { cn } from "#lib/utils.ts";
import type { DevicesResponse, PairResponse } from "../shared/protocol.ts";
import { useLayout } from "./layout.ts";
import { isUnpaired } from "./unpaired.ts";

export function DevicesMenu({ onUnpaired }: { onUnpaired: () => void }) {
	const [open, setOpen] = useState(false);
	const [list, setList] = useState<DevicesResponse>();
	const [confirming, setConfirming] = useState<string>();
	const [link, setLink] = useState<PairResponse>();
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string>();
	const phone = useLayout() === "phone";

	const load = async () => {
		const res = await fetch("/api/devices");
		if (await isUnpaired(res)) return onUnpaired();
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		setList((await res.json()) as DevicesResponse);
	};

	const revoke = async (id: string) => {
		setError(undefined);
		const res = await fetch(`/api/devices/${id}`, { method: "DELETE" }).catch(
			() => null,
		);
		setConfirming(undefined);
		if (res && (await isUnpaired(res))) return onUnpaired();
		if (!res || (!res.ok && res.status !== 404)) {
			return setError("No se pudo desvincular ese dispositivo.");
		}
		if (id === list?.current) return onUnpaired();
		await load().catch(() => {});
	};

	const newLink = async () => {
		setError(undefined);
		setCopied(false);
		const res = await fetch("/api/pair", { method: "POST" });
		if (await isUnpaired(res)) return onUnpaired();
		if (!res.ok) return setError("No se pudo crear el enlace.");
		setLink((await res.json()) as PairResponse);
	};

	const copy = async (url: string) => {
		await navigator.clipboard.writeText(url).then(
			() => setCopied(true),
			() => {},
		);
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				setConfirming(undefined);
				setError(undefined);
				if (next) {
					setLink(undefined);
					void load().catch(() => {});
				}
			}}
		>
			<PopoverTrigger className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[13px] text-muted-foreground transition-[transform,color,background-color] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.97] aria-expanded:bg-muted aria-expanded:text-foreground">
				<MonitorSmartphone aria-hidden className="size-3.5" />
				<span className={cn(phone && "sr-only")}>Dispositivos</span>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="max-h-[min(70dvh,520px)] w-[min(340px,calc(100vw-24px))] gap-0 overflow-y-auto p-1.5"
			>
				<h3 className="px-2 pt-1 pb-0.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Navegadores vinculados
				</h3>
				<ul aria-label="Navegadores vinculados" className="py-1">
					{list?.devices.map((d) => {
						const mine = d.id === list.current;
						const asking = confirming === d.id;
						return (
							<li
								key={d.id}
								className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-[13px]"
							>
								<span className="grid min-w-0 flex-1">
									<span className="truncate" title={d.name}>
										{d.name}
									</span>
									<span className="text-xs text-muted-foreground">
										{mine ? "Este navegador · " : ""}
										{d.lan ? "Por Wi-Fi · " : ""}desde el{" "}
										<time dateTime={d.created}>{shortDate(d.created)}</time>
									</span>
								</span>
								<button
									type="button"
									aria-label={
										asking
											? `Confirmar: desvincular ${d.name}`
											: `Desvincular ${d.name}`
									}
									onClick={() =>
										asking ? void revoke(d.id) : setConfirming(d.id)
									}
									className={
										asking
											? "h-7 shrink-0 rounded-md bg-destructive/10 px-2 text-xs font-medium text-destructive transition-transform duration-150 ease-out active:scale-[0.97] dark:bg-destructive/20"
											: "h-7 shrink-0 rounded-md px-2 text-xs text-muted-foreground transition-[transform,color,background-color] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.97]"
									}
								>
									{asking ? "¿Seguro?" : "Desvincular"}
								</button>
							</li>
						);
					})}
				</ul>
				{confirming === list?.current && (
					<p className="px-2 pb-1.5 text-xs text-muted-foreground text-pretty">
						Este navegador va a necesitar un enlace nuevo para volver a entrar.
					</p>
				)}
				<div className="mt-1 grid gap-2 border-t p-1.5 pt-2.5">
					{link ? (
						<>
							<div className="flex gap-1.5">
								<Input
									readOnly
									value={link.url}
									aria-label="Enlace para vincular"
									onFocus={(e) => e.currentTarget.select()}
									className="h-8 font-mono text-xs"
								/>
								<button
									type="button"
									aria-label={copied ? "Copiado" : "Copiar enlace"}
									onClick={() => void copy(link.url)}
									className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-muted-foreground transition-[transform,color] duration-150 ease-out hover:text-foreground active:scale-[0.94]"
								>
									{copied ? (
										<Check aria-hidden className="size-3.5" />
									) : (
										<Copy aria-hidden className="size-3.5" />
									)}
								</button>
							</div>
							<p className="px-0.5 text-xs text-muted-foreground text-pretty">
								Abrilo en el otro navegador. Sirve una vez y vence a las{" "}
								<time dateTime={link.expiresAt}>
									{shortTime(link.expiresAt)}
								</time>
								.
							</p>
						</>
					) : (
						<button
							type="button"
							onClick={() => void newLink()}
							className="h-8 rounded-lg border bg-card px-2.5 text-[13px] transition-transform duration-150 ease-out active:scale-[0.97]"
						>
							Vincular otro navegador
						</button>
					)}
				</div>
				{error && (
					<p role="alert" className="px-2 pb-1.5 text-[13px] text-destructive">
						{error}
					</p>
				)}
			</PopoverContent>
		</Popover>
	);
}

const shortDate = (iso: string) =>
	new Date(iso).toLocaleDateString("es", { day: "numeric", month: "short" });

const shortTime = (iso: string) =>
	new Date(iso).toLocaleTimeString("es", {
		hour: "2-digit",
		minute: "2-digit",
	});
