require("dotenv").config();
// e2e-only override: 6.3's MockPaymentProvider makes a real outbound
// HTTP call to API_PUBLIC_BASE_URL for its own webhook delivery, which
// needs a genuinely listening address -- the dev default
// (localhost:3000) risks colliding with an actual `pnpm dev` instance
// if one happens to be running during a test pass. Every e2e test file
// gets this override (setupFiles runs before a test file's own
// imports); only the suite that actually calls app.listen() on this
// exact port depends on the value.
process.env.API_PUBLIC_BASE_URL = "http://127.0.0.1:4090";
