import { defineConfig, devices } from "@playwright/test";

const port = 4318;

export default defineConfig({
	testDir: "e2e",
	testMatch: "**/*.pw.ts",
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? "github" : "list",
	use: { baseURL: `http://127.0.0.1:${port}` },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: "bun run build && bun run start",
		url: `http://127.0.0.1:${port}`,
		// Recorded streams instead of Claude; see `driver()` in src/server/main.ts.
		env: { PORT: String(port), LEMMA_FAKE: "1", LEMMA_FAKE_DELAY_MS: "15" },
		reuseExistingServer: false,
	},
});
