require("dotenv").config();

// e2e-only Redis isolation. Dev servers (api, worker, customer-web) and any
// stale queue backlog live in Redis logical database 0. Every e2e run used to
// share that database, which caused, repeatedly: a live dev worker draining
// the notification jobs a test had just enqueued (`Expected length: 1,
// Received length: 0`), an orphaned test-spawned worker chewing through a
// 1,500-job backlog at ~100% CPU for hours, and a backlog nobody drained
// growing with every run. Tests now run in their own logical database, so
// none of that can cross the boundary in either direction, and it can be
// flushed freely (`redis-cli -n 9 FLUSHDB`) without touching dev data.
// Override with E2E_REDIS_DB (E2E_REDIS_DB=0 opts out), or by putting an
// explicit /<index> in REDIS_URL. Both services use the SAME database so a
// test that spawns a real worker child (it inherits process.env) still
// shares a queue namespace with the API under test. Postgres is still
// shared with dev: separate-database isolation is tracked in the plan (25).
{
  const url = process.env.REDIS_URL;
  if (url && !/\/\d+\/?$/.test(url)) {
    process.env.REDIS_URL = `${url.replace(/\/$/, "")}/${process.env.E2E_REDIS_DB ?? "9"}`;
  }
}
