#!/usr/bin/env node
// §12.8's own "post-deploy smoke test": a fast, non-destructive
// confidence check that the just-deployed staging environment is
// actually reachable and its core dependencies (Postgres/Redis/S3, via
// /v1/health/ready) are wired correctly -- NOT a full walk of §121's
// golden path (that's §13.1's own scope, a Playwright suite that pays,
// uploads, and prints). Read-only, no state created: safe to run
// against real staging after every deploy without leaving debris
// behind the way a full order-creation flow would.
//
// Usage: STAGING_API_URL=https://api.example.com STAGING_WEB_URL=https://example.com node smoke-test.mjs

const apiUrl = process.env.STAGING_API_URL;
const webUrl = process.env.STAGING_WEB_URL;

if (!apiUrl || !webUrl) {
  console.error("Set STAGING_API_URL and STAGING_WEB_URL first.");
  process.exit(1);
}

const checks = [
  {
    name: "api liveness (/v1/health)",
    run: async () => {
      const res = await fetch(`${apiUrl}/v1/health`);
      const body = await res.json();
      if (res.status !== 200 || body.status !== "ok") {
        throw new Error(`expected 200 {status:"ok"}, got ${res.status} ${JSON.stringify(body)}`);
      }
    },
  },
  {
    name: "api readiness (/v1/health/ready) -- Postgres/Redis/S3 all reachable",
    run: async () => {
      const res = await fetch(`${apiUrl}/v1/health/ready`);
      const body = await res.json();
      if (res.status !== 200 || body.status !== "ready") {
        throw new Error(`expected 200 {status:"ready"}, got ${res.status} ${JSON.stringify(body)}`);
      }
    },
  },
  {
    name: "api serves a real read-only query end to end (/v1/shops)",
    run: async () => {
      const res = await fetch(`${apiUrl}/v1/shops`);
      if (res.status !== 200) {
        throw new Error(`expected 200, got ${res.status}`);
      }
      const body = await res.json();
      if (!Array.isArray(body)) {
        throw new Error(`expected an array response, got ${JSON.stringify(body).slice(0, 200)}`);
      }
    },
  },
  {
    name: "web serves the landing page",
    run: async () => {
      const res = await fetch(webUrl);
      if (res.status !== 200) {
        throw new Error(`expected 200, got ${res.status}`);
      }
    },
  },
];

let failed = false;
for (const check of checks) {
  try {
    await check.run();
    console.log(`PASS: ${check.name}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL: ${check.name} -- ${error.message}`);
  }
}

if (failed) {
  console.error("\nSmoke test failed. See infrastructure/scripts/rollback.sh.");
  process.exit(1);
}
console.log("\nAll smoke checks passed.");
