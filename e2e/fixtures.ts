/**
 * Every test's browser starts paired with both e2e servers: the cookies
 * e2e/seed-device.ts left before each server started. Cookies are per host,
 * not per port, so each server's cookie carries its port in its name.
 * `browser.newContext()` inherits that state too; `unpaired(browser)` makes a
 * context with no cookies.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, test as base } from "@playwright/test";
import { E2E_CONFIG_DIRS } from "../playwright.config.ts";

const cookie = (dir: string) => {
	const [name = "", value = ""] = readFileSync(join(dir, "e2e-cookie"), "utf8")
		.trim()
		.split("=");
	return {
		name,
		value,
		domain: "127.0.0.1",
		path: "/",
		expires: -1,
		httpOnly: true,
		secure: false,
		sameSite: "Strict" as const,
	};
};

export const test = base.extend({
	// biome-ignore lint/correctness/noEmptyPattern: Playwright needs the destructuring
	storageState: async ({}, use) => {
		await use({ cookies: E2E_CONFIG_DIRS.map(cookie), origins: [] });
	},
});

export { expect, type Page } from "@playwright/test";

/** A browser context with no cookies: a browser that never paired. */
export const unpaired = (browser: Browser) =>
	browser.newContext({ storageState: { cookies: [], origins: [] } });
