import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 3001;
const API_PORT = 3000;

/** Drives a real Chromium browser against the real dev stack (Postgres/
 * Redis via `infrastructure/docker/docker-compose.dev.yml`, which must
 * already be up -- same assumption every other integration/e2e suite in
 * this project makes) and real `next dev` + `nest start --watch`
 * servers -- not a mocked DOM, not a mocked backend. This is what
 * "start the dev server and use the feature in a browser" means for a
 * headless environment with no interactive browser tool available. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @print-automated/api dev",
      cwd: "../..",
      url: `http://localhost:${API_PORT}/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @print-automated/customer-web dev",
      cwd: "../..",
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
