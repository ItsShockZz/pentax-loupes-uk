// Playwright config for the site's end-to-end quality gates.
//
// These are guard rails, not unit tests: they check the things that quietly
// regress on a marketing site — accessibility, layout overflow on phones,
// touch-target sizes, page weight, and that the tour becomes scrubbable
// quickly instead of after a long download.
//
//   npm run test:e2e            all projects
//   npm run test:e2e -- --ui    interactive
//
// The node:test suites in tests/*.test.mjs are separate and still run with
// `npm test`; Playwright only picks up tests/e2e/.
import { defineConfig, devices } from "@playwright/test";

const PORT = 8000;
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `node scripts/dev-server.mjs --port ${PORT}`,
    url: BASE,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
