import { ForbiddenException } from "@nestjs/common";

/** Which branch a staff list should be limited to. A branch-bound caller (their own branch is not
 * null) only ever sees their own branch's people: naming another branch is refused, naming nothing
 * means their own. An all-branches caller (owner, or someone an owner marked so) sees everyone
 * unless they narrow it to one branch. Returns the branch id to filter by, or undefined for none. */
export function resolveBranchScope(
  actorBranchId: string | null,
  requested: string | undefined,
): string | undefined {
  if (actorBranchId === null) {
    return requested;
  }
  if (requested !== undefined && requested !== actorBranchId) {
    throw new ForbiddenException("You can only see your own branch.");
  }
  return actorBranchId;
}
