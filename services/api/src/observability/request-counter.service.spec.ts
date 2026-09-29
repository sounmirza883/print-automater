import { RequestCounterService, TRAFFIC_WINDOW_MS } from "./request-counter.service.js";

describe("RequestCounterService windowing (23.7 admin panel: live system summary)", () => {
  it("counts every recorded request towards the all-time total, forever", () => {
    const counter = new RequestCounterService();
    counter.record(0);
    counter.record(1_000);
    counter.record(2_000);
    expect(counter.getStats(2_000).totalSinceStart).toBe(3);
  });

  it("requestsPerMinute only counts requests inside the trailing 60s window", () => {
    const counter = new RequestCounterService();
    counter.record(0);
    // Still inside the window measured from t=59_999.
    expect(counter.getStats(TRAFFIC_WINDOW_MS - 1).requestsPerMinute).toBe(1);
    // Exactly 60_000ms old: inclusive, still counted (window is [now - 60_000, now]).
    expect(counter.getStats(TRAFFIC_WINDOW_MS).requestsPerMinute).toBe(1);
    // One tick past the window: aged out.
    expect(counter.getStats(TRAFFIC_WINDOW_MS + 1).requestsPerMinute).toBe(0);
  });

  it("prunes stale timestamps as time passes, without discarding the running total", () => {
    const counter = new RequestCounterService();
    counter.record(0);
    counter.record(30_000);
    expect(counter.getStats(30_000).requestsPerMinute).toBe(2);

    // t=0's request has aged out of the 60s window; t=30_000's has not.
    expect(counter.getStats(70_000).requestsPerMinute).toBe(1);
    expect(counter.getStats(70_000).totalSinceStart).toBe(2);

    // Both have now aged out.
    expect(counter.getStats(200_000).requestsPerMinute).toBe(0);
    expect(counter.getStats(200_000).totalSinceStart).toBe(2);
  });

  it("defaults to Date.now() when no explicit timestamp is given", () => {
    const counter = new RequestCounterService();
    counter.record();
    const stats = counter.getStats();
    expect(stats.totalSinceStart).toBe(1);
    expect(stats.requestsPerMinute).toBe(1);
  });
});
