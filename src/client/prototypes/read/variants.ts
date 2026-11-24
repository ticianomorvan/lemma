import type { CardStyle, PinStyle } from "./margin.tsx";

/**
 * The details step 7 leaves open, one value per variant. Each variant is a
 * coherent answer to all of them, so flipping compares whole designs.
 */
export type Variant = {
	name: string;
	/** How cards share the margin when passages crowd it. */
	cards: CardStyle;
	/** What the cards fold into while the chat is open. */
	pins: PinStyle;
	/** How the chat opens on a wide screen. */
	panel: "push" | "overlay" | "swap";
	/** Where the Leer/Practicar control sits. */
	switcher: "center" | "start" | "compact";
	/** What replaces the margin on a phone. */
	phone: "sheet" | "strip" | "tabs";
};

export const VARIANTS: Variant[] = [
	{
		name: "Columna",
		cards: "stack",
		pins: "dots",
		panel: "push",
		switcher: "center",
		phone: "sheet",
	},
	{
		name: "Capas",
		cards: "group",
		pins: "bars",
		panel: "overlay",
		switcher: "start",
		phone: "strip",
	},
	{
		name: "Foco",
		cards: "focus",
		pins: "inline",
		panel: "swap",
		switcher: "compact",
		phone: "tabs",
	},
];
