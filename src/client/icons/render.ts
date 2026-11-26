/**
 * `bun src/client/icons/render.ts`: renders the app icon's SVG sources to the
 * PNGs the manifest and Safari ask for, in `src/client/public/`. The PNGs are
 * committed; run this again after changing a source.
 *
 * - `icon.svg`: the macOS tile (a rounded square on the 1024 grid, transparent
 *   around it) for the Dock and the window.
 * - `icon-maskable.svg`: full bleed, the glyph inside the 80% safe zone, for
 *   platforms that cut their own shape.
 * - `public/favicon.svg` (served as is): full bleed with rounded corners, the
 *   glyph larger, so it reads at 16 px in a tab.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const here = import.meta.dirname;
const out = join(here, "..", "public");
const renders = [
	["icon.svg", "icon-192.png", 192],
	["icon.svg", "icon-512.png", 512],
	["icon-maskable.svg", "icon-maskable-192.png", 192],
	["icon-maskable.svg", "icon-maskable-512.png", 512],
	["icon-maskable.svg", "apple-touch-icon.png", 180],
] as const;

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [source, target, size] of renders) {
	const svg = readFileSync(join(here, source), "utf8");
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
	);
	await page.screenshot({ path: join(out, target), omitBackground: true });
	console.log(`${target} (${size}×${size})`);
}
await browser.close();
