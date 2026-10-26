import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./test/browser",
	testMatch: "**/*.browser.ts",
	outputDir: "../../.scratch/playwright",
	fullyParallel: false,
	workers: 1,
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:4176",
		headless: true,
		launchOptions: {
			executablePath: existsSync("/usr/bin/chromium")
				? "/usr/bin/chromium"
				: undefined,
		},
	},
	webServer: {
		command: "bun test/browser/server.ts",
		url: "http://127.0.0.1:4176",
		reuseExistingServer: false,
	},
});
