import { defineConfig, devices } from "@playwright/test";

const port = 4318;
/** A server with no study folder yet, for the first-run screen. */
export const setupPort = 4319;

// Both servers serve the build `bun run test:e2e` makes first. Each starts
// from an empty folder under .e2e/, and recorded streams replace Claude
// (see `driver()` in src/server/main.ts).
const fake = { LEMMA_FAKE: "1", LEMMA_FAKE_DELAY_MS: "15" };

export default defineConfig({
	testDir: "e2e",
	testMatch: "**/*.pw.ts",
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? "github" : "list",
	use: { baseURL: `http://127.0.0.1:${port}` },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: [
		{
			command: "rm -rf .e2e/study && mkdir -p .e2e/study && bun run start",
			url: `http://127.0.0.1:${port}`,
			env: {
				...fake,
				PORT: String(port),
				LEMMA_STUDY_DIR: ".e2e/study",
				LEMMA_CONFIG_DIR: ".e2e/config",
			},
			reuseExistingServer: false,
		},
		{
			command: "rm -rf .e2e/setup && bun run start",
			url: `http://127.0.0.1:${setupPort}`,
			env: {
				...fake,
				PORT: String(setupPort),
				LEMMA_CONFIG_DIR: ".e2e/setup/config",
			},
			reuseExistingServer: false,
		},
	],
});
