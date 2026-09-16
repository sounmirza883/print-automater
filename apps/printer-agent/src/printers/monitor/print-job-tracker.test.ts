import { PrintJobTracker } from "./print-job-tracker.js";
import type { QueueSnapshot } from "./print-queue.js";

function job(overrides: Partial<QueueSnapshot> & { jobId: number }): QueueSnapshot {
  return {
    status: "Printing",
    jobStatus: "Printing",
    pagesPrinted: 0,
    totalPages: 1,
    ...overrides,
  };
}

describe("PrintJobTracker (9.11)", () => {
  it("resolves PRINTED when a newly-seen job later vanishes from the queue cleanly", () => {
    const tracker = new PrintJobTracker(new Set());

    expect(tracker.feed([job({ jobId: 5, pagesPrinted: 0 })])).toBeNull();
    expect(tracker.feed([job({ jobId: 5, pagesPrinted: 1 })])).toBeNull();
    // vanished -- no longer in the snapshot at all
    expect(tracker.feed([])).toBe("PRINTED");
  });

  it("§9.11's own Done-when: paper-out mid-job is detected and reported as a failure, not a success", () => {
    const tracker = new PrintJobTracker(new Set());

    expect(tracker.feed([job({ jobId: 5, status: "Printing" })])).toBeNull();
    expect(
      tracker.feed([job({ jobId: 5, status: "Error", jobStatus: "Out of Paper" })]),
    ).toBeNull();
    // the failed job eventually leaves the queue (staff cancelled it,
    // or the driver gave up) -- the earlier error is what decides this,
    // not merely "it's no longer in the queue."
    expect(tracker.feed([])).toBe("FAILED");
  });

  it("a job still showing an error at the polling deadline resolves FAILED via onTimeout(), not UNKNOWN", () => {
    const tracker = new PrintJobTracker(new Set());
    tracker.feed([job({ jobId: 5, status: "Printing" })]);
    tracker.feed([job({ jobId: 5, status: "Error", jobStatus: "Paper Jam" })]);

    expect(tracker.onTimeout()).toBe("FAILED");
  });

  it("a job that never appears in any poll before the deadline resolves UNKNOWN, never a guessed PRINTED", () => {
    const tracker = new PrintJobTracker(new Set([1, 2]));
    expect(tracker.feed([job({ jobId: 1 }), job({ jobId: 2 })])).toBeNull();
    expect(tracker.feed([job({ jobId: 1 }), job({ jobId: 2 })])).toBeNull();

    expect(tracker.onTimeout()).toBe("UNKNOWN");
  });

  it("ignores pre-existing baseline jobs -- only a genuinely new job id is ever tracked", () => {
    const tracker = new PrintJobTracker(new Set([1, 2]));
    // Only baseline jobs present -- must not be mistaken for "our" job.
    expect(tracker.feed([job({ jobId: 1 }), job({ jobId: 2 })])).toBeNull();
    // Now a real new job shows up alongside them.
    expect(tracker.feed([job({ jobId: 1 }), job({ jobId: 2 }), job({ jobId: 3 })])).toBeNull();
    // The new one vanishes; the baseline jobs are still there and irrelevant.
    expect(tracker.feed([job({ jobId: 1 }), job({ jobId: 2 })])).toBe("PRINTED");
  });

  it("a failed poll (null snapshot) is a no-op -- it neither advances nor corrupts tracking", () => {
    const tracker = new PrintJobTracker(new Set());
    expect(tracker.feed([job({ jobId: 5 })])).toBeNull();
    expect(tracker.feed(null)).toBeNull();
    expect(tracker.feed(null)).toBeNull();
    expect(tracker.feed([])).toBe("PRINTED");
  });

  it("a non-error status like Paused does not trigger a false failure", () => {
    const tracker = new PrintJobTracker(new Set());
    expect(tracker.feed([job({ jobId: 5, status: "Paused", jobStatus: "Paused" })])).toBeNull();
    expect(tracker.feed([job({ jobId: 5, status: "Printing", jobStatus: "Printing" })])).toBeNull();
    expect(tracker.feed([])).toBe("PRINTED");
  });

  it("matches an error indicator whether it appears in Status or JobStatus", () => {
    const statusOnly = new PrintJobTracker(new Set());
    statusOnly.feed([job({ jobId: 5, status: "Error", jobStatus: "Printing" })]);
    expect(statusOnly.onTimeout()).toBe("FAILED");

    const jobStatusOnly = new PrintJobTracker(new Set());
    jobStatusOnly.feed([job({ jobId: 5, status: "Printing", jobStatus: "Door Open" })]);
    expect(jobStatusOnly.onTimeout()).toBe("FAILED");
  });
});
