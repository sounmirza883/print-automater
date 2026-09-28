import { formatAge, jobBadges } from "./job-view";

describe("jobBadges (23.33)", () => {
  it("always shows the status first", () => {
    expect(jobBadges({ status: "QUEUED", blockedReason: null })).toEqual([
      { label: "Queued", tone: "neutral" },
    ]);
  });

  it("adds how long a job has been paused, a raised priority and a late-print hold", () => {
    const now = Date.parse("2026-09-28T10:20:00.000Z");
    const badges = jobBadges(
      {
        status: "PAUSED",
        priority: 20,
        pausedAt: "2026-09-28T10:00:00.000Z",
        blockedReason: "MANUAL_APPROVAL_REQUIRED",
      },
      now,
    );
    expect(badges).toEqual([
      { label: "Paused 20 min ago", tone: "caution" },
      { label: "Urgent priority", tone: "danger" },
      { label: "Held by late print", tone: "danger" },
    ]);
    expect(jobBadges({ status: "QUEUED", priority: 10, blockedReason: null })[1]).toEqual({
      label: "High priority",
      tone: "caution",
    });
  });

  it("does not label normal priority or an ordinary block as held", () => {
    const badges = jobBadges({ status: "WAITING", priority: 0, blockedReason: "NO_PAPER" });
    expect(badges).toHaveLength(1);
  });
});

describe("formatAge", () => {
  const now = Date.parse("2026-09-28T12:00:00.000Z");
  it("says how long ago, coarsely", () => {
    expect(formatAge("2026-09-28T11:59:40.000Z", now)).toBe("just now");
    expect(formatAge("2026-09-28T11:40:00.000Z", now)).toBe("20 min ago");
    expect(formatAge("2026-09-28T09:00:00.000Z", now)).toBe("3 h ago");
    expect(formatAge(null, now)).toBe("");
  });
});
