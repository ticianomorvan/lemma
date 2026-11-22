import { defineConfig, devices } from "@playwright/test";

const port = 4318;
/** A server with no study folder yet, for the first-run screen. */
export const setupPort = 4319;

/** Each server's config folder, where e2e/seed-device.ts pairs the tests' browser. */
export const E2E_CONFIG_DIRS = [".e2e/config", ".e2e/setup/config"] as const;
const [config, setupConfig] = E2E_CONFIG_DIRS;

// Both servers serve the build `bun run test:e2e` makes first. Each starts
// from an empty folder under .e2e/ with one paired device, and recorded
// streams replace Claude (see `driver()` in src/server/main.ts).
const env = { LEMMA_FAKE: "1", LEMMA_FAKE_DELAY_MS: "15", LEMMA_OPEN: "0" };

export default defineConfig({
	testDir: "e2e",
	testMatch: "**/*.pw.ts",
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? "github" : "list",
	use: { baseURL: `http://127.0.0.1:${port}` },
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: [
		{
			command: `rm -rf .e2e/study ${config} && mkdir -p .e2e/study && bun e2e/seed-device.ts ${config} ${port} && bun run start`,
			url: `http://127.0.0.1:${port}`,
			env: {
				...env,
				PORT: String(port),
				LEMMA_STUDY_DIR: ".e2e/study",
				LEMMA_CONFIG_DIR: config,
			},
			reuseExistingServer: false,
		},
		{
			command: `rm -rf .e2e/setup && bun e2e/seed-device.ts ${setupConfig} ${setupPort} && bun run start`,
			url: `http://127.0.0.1:${setupPort}`,
			env: {
				...env,
				PORT: String(setupPort),
				LEMMA_CONFIG_DIR: setupConfig,
			},
			reuseExistingServer: false,
		},
	],
});
