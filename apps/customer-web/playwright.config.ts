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
  // `fullyParallel: false` only serializes tests *within* one file --
  // Playwright still spreads separate spec files across concurrent
  // worker processes by default. Against a real, shared, mutable dev
  // backend (this config's own whole point) that's a real correctness
  // problem, not just slower: two files logging in/registering at once
  // hit the exact same per-IP/per-email rate-limit buckets (§85) and
  // can race Next.js's own dev-server request handling badly enough to
  // corrupt an in-flight request body. Only surfaced once a second spec
  // file (golden-path.spec.ts, 13.1) existed to run alongside
  // auth-round-trip.spec.ts -- one file alone never exercised this.
  workers: 1,
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
    // §121/13.1's own golden path needs a real document to reach READY
    // (§2.7's pipeline), which nothing does without a live worker
    // consuming the document-processing queue. No `url`/`port` here --
    // §2.6 gives it no HTTP server to poll -- so this only starts the
    // process; golden-path.spec.ts's own polling wait for the
    // document's status is what actually confirms it's up and working,
    // the same "start the process, let the test itself prove
    // readiness" shape §2.6/12.6's own worker healthcheck already uses
    // for the exact same reason (nothing to poll over HTTP).
    {
      command: "pnpm --filter @print-automated/worker dev",
      cwd: "../..",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
