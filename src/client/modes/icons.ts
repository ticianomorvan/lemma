/** Each default mode's icon; a mode the student added gets the sparkle. */
import {
	BookOpenText,
	Lightbulb,
	type LucideIcon,
	SearchCheck,
	Sparkles,
	Timer,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
	"read-along": BookOpenText,
	explain: Lightbulb,
	review: SearchCheck,
	"exam-prep": Timer,
};
export const iconOf = (id: string) => ICONS[id] ?? Sparkles;

/** The press feedback the mode controls share. */
export const press =
	"transition-[transform,background-color,color,border-color] duration-150 ease-out active:scale-[0.97]";
