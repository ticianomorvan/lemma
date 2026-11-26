/**
 * The composer's "Foto desde el teléfono" button. Its QR panel
 * (phone-pairing.tsx) and the QR encoder load when it first opens, so they
 * stay out of the app's first load.
 */
import { Smartphone } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#components/ui/popover.tsx";

const PhonePairing = lazy(() => import("./phone-pairing.tsx"));

/** The composer's "Foto desde el teléfono" button and its QR panel. */
export function PhonePopover({
	session,
	waiting,
}: {
	session?: string;
	/** Photos waiting in the composer. */
	waiting: number;
}) {
	const [open, setOpen] = useState(false);
	// A photo arrived (most likely from the phone): the panel steps aside so
	// the strip it covers shows it.
	const seen = useRef(waiting);
	useEffect(() => {
		if (waiting > seen.current) setOpen(false);
		seen.current = waiting;
	}, [waiting]);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				aria-label="Foto desde el teléfono"
				className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-[transform,color,background-color] duration-150 ease-out hover:bg-muted hover:text-foreground active:scale-[0.96] aria-expanded:bg-muted aria-expanded:text-foreground"
			>
				<Smartphone aria-hidden className="size-4" />
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="start"
				className="w-[min(300px,calc(100vw-24px))] p-4"
			>
				{open && (
					<Suspense
						fallback={
							<div className="aspect-[3/4] w-full animate-pulse rounded-md bg-muted" />
						}
					>
						<PhonePairing session={session} />
					</Suspense>
				)}
			</PopoverContent>
		</Popover>
	);
}
