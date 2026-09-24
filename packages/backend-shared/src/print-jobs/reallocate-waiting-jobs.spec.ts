import { BlockedReason } from "@print-automated/types";
import { AVAILABILITY_BLOCKED_REASONS } from "./reallocate-waiting-jobs.js";

/** 19.15: which reasons queue recovery may retry is a product decision, so it is
 * pinned. A reason that needs a human (compatibility, paper, operator, approval)
 * must never be silently re-allocated just because some printer is online. */
describe("AVAILABILITY_BLOCKED_REASONS (19.15)", () => {
  it("contains exactly the availability-type reasons", () => {
    expect([...AVAILABILITY_BLOCKED_REASONS].sort()).toEqual(
      [
        BlockedReason.PAGE_LIMIT_REACHED,
        BlockedReason.PRINTER_DISABLED,
        BlockedReason.PRINTER_OFFLINE,
      ].sort(),
    );
  });

  it("excludes every reason that needs a human or a different change", () => {
    for (const reason of [
      BlockedReason.NO_COMPATIBLE_PRINTER,
      BlockedReason.NO_PAPER,
      BlockedReason.OPERATOR_UNAVAILABLE,
      BlockedReason.MANUAL_APPROVAL_REQUIRED,
    ]) {
      expect(AVAILABILITY_BLOCKED_REASONS).not.toContain(reason);
    }
  });
});
