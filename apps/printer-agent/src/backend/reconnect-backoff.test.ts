import { ReconnectBackoff } from "./reconnect-backoff.js";

/** §90/10.7's own Done-when: "a 5-minute outage on both clients ends in
 * full convergence with the backend and zero duplicated work." This is
 * the pure calculator half of that -- a hermetic unit test, no fake
 * timers or real sleeps needed since the class never calls setTimeout
 * itself; it only returns the delay for index.ts's own loop to sleep
 * on. */
describe("ReconnectBackoff (10.7)", () => {
  it("doubles the interval on each consecutive failure, capped at maxIntervalMs", () => {
    const backoff = new ReconnectBackoff({ initialIntervalMs: 1000, maxIntervalMs: 8000 });

    expect(backoff.recordFailure()).toBe(1000);
    expect(backoff.recordFailure()).toBe(2000);
    expect(backoff.recordFailure()).toBe(4000);
    expect(backoff.recordFailure()).toBe(8000);
    // Capped -- stays at the ceiling for a persistent outage rather
    // than growing unbounded.
    expect(backoff.recordFailure()).toBe(8000);
    expect(backoff.recordFailure()).toBe(8000);
  });

  it("recordSuccess with no prior failures is just a healthy tick, not a reconnect", () => {
    const backoff = new ReconnectBackoff({ initialIntervalMs: 1000, maxIntervalMs: 8000 });

    expect(backoff.recordSuccess()).toBe(false);
    expect(backoff.recordSuccess()).toBe(false);
  });

  it("recordSuccess after one or more failures reports a reconnect exactly once", () => {
    const backoff = new ReconnectBackoff({ initialIntervalMs: 1000, maxIntervalMs: 8000 });

    backoff.recordFailure();
    backoff.recordFailure();
    backoff.recordFailure();

    expect(backoff.recordSuccess()).toBe(true);
    // The very next healthy tick is NOT another reconnect -- only the
    // first success after an outage is.
    expect(backoff.recordSuccess()).toBe(false);
  });

  it("a fresh outage after a reconnect starts backing off from the initial interval again, not from the previous cap", () => {
    const backoff = new ReconnectBackoff({ initialIntervalMs: 1000, maxIntervalMs: 8000 });

    backoff.recordFailure();
    backoff.recordFailure();
    backoff.recordFailure();
    backoff.recordFailure(); // now at the 8000 cap
    backoff.recordSuccess(); // reconnected, resets

    expect(backoff.recordFailure()).toBe(1000);
  });
});
