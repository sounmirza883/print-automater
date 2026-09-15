import type { RejectionReason } from "./rejection-reason.js";

/** A deliberate, expected outcome of validation (§86) -- not a bug, not
 * an infra failure. The processor catches this specifically and treats
 * it as a SUCCESSFUL job completion (correctly rejecting a bad upload
 * is success), never triggering BullMQ's retry policy. Any other thrown
 * error is a real failure and is allowed to propagate. */
export class DocumentRejectedError extends Error {
  constructor(public readonly reason: RejectionReason) {
    super(reason);
    this.name = "DocumentRejectedError";
  }
}
