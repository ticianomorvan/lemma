/** The open file and page in Read; it lists the course's other PDFs to switch to. */
import { ChevronDown, FileText } from "lucide-react";
import { useState } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#components/ui/popover.tsx";
import { cn } from "#lib/utils.ts";
import type { Material } from "./read-view.tsx";

export function FileMenu({
	files,
	file,
	onFile,
	label,
}: {
	files: Material[];
	file: string;
	onFile: (path: string) => void;
	label: string;
}) {
	const [open, setOpen] = useState(false);
	const pill =
		"inline-flex h-7 max-w-[min(420px,70vw)] items-center gap-1.5 rounded-full border bg-card/90 px-2.5 text-[12px] text-muted-foreground shadow-sm backdrop-blur";
	if (files.length < 2) {
		return (
			<span className={pill}>
				<FileText aria-hidden className="size-3.5 shrink-0" />
				<span className="truncate tabular-nums">{label}</span>
			</span>
		);
	}
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				aria-label={`Apunte: ${label}. Cambiar de apunte`}
				className={cn(
					pill,
					"transition-[color,transform] duration-150 ease-out hover:text-foreground active:scale-[0.97]",
				)}
			>
				<FileText aria-hidden className="size-3.5 shrink-0" />
				<span className="truncate tabular-nums">{label}</span>
				<ChevronDown aria-hidden className="size-3.5 shrink-0" />
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 gap-0 p-1">
				{files.map((f) => (
					<button
						key={f.path}
						type="button"
						aria-current={f.path === file || undefined}
						onClick={() => {
							setOpen(false);
							onFile(f.path);
						}}
						className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13.5px] hover:bg-secondary aria-[current]:font-medium aria-[current]:text-primary"
					>
						<FileText aria-hidden className="size-3.5 shrink-0 text-subtle" />
						<span className="min-w-0 truncate">{f.name}</span>
						<span className="ml-auto max-w-[40%] truncate text-[11.5px] text-subtle">
							{f.path.split("/").slice(2, -1).join("/")}
						</span>
					</button>
				))}
			</PopoverContent>
		</Popover>
	);
}
