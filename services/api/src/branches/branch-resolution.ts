import { ForbiddenException, HttpStatus } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { AppException } from "@print-automated/backend-shared";

export interface ResolvedBranch {
  id: string;
  name: string;
}

interface LockedBranch extends ResolvedBranch {
  isOpen: boolean;
  archivedAt: Date | null;
}

const OLDEST_FIRST = [{ createdAt: "asc" }, { id: "asc" }] as const;

/** Reads one of the business's branches and share-locks it until the caller's transaction ends, so
 * the branch cannot be archived between this check and the row that points at it committing
 * (archiving takes the branch rows FOR UPDATE). A branch of another business reads as missing. */
async function lockBranch(
  tx: Prisma.TransactionClient,
  shopId: string,
  branchId: string,
): Promise<LockedBranch> {
  const rows = await tx.$queryRaw<LockedBranch[]>`
    SELECT id, name, is_open AS "isOpen", archived_at AS "archivedAt"
    FROM branches WHERE id = ${branchId} AND shop_id = ${shopId} FOR SHARE
  `;
  const branch = rows[0];
  if (!branch) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      "BRANCH_NOT_FOUND",
      "No such branch in this business.",
      false,
    );
  }
  if (branch.archivedAt) {
    throw new AppException(
      HttpStatus.CONFLICT,
      "BRANCH_ARCHIVED",
      "That branch is archived.",
      false,
    );
  }
  return branch;
}

/** For a caller that already decided the branch by the staff rules (a counter order, after
 * `resolveBranchForStaffOperation`) and only needs it confirmed usable and share-locked inside the
 * transaction that writes the row pointing at it. */
export async function lockUsableBranch(
  tx: Prisma.TransactionClient,
  shopId: string,
  branchId: string,
): Promise<ResolvedBranch> {
  const branch = await lockBranch(tx, shopId, branchId);
  return { id: branch.id, name: branch.name };
}

/** The branch a STAFF action happens at (issuing a pairing code, a counter order, registering a
 * printer by hand, the destination of a PC move). The same rules as inviting someone to a branch:
 *   - a branch-bound person always works at their own branch (naming another is 403);
 *   - otherwise the named branch; or, naming none, the business's only branch; with several
 *     branches and none named the request is refused (400 BRANCH_REQUIRED);
 *   - the branch must belong to this business and not be archived. A CLOSED branch is fine: the
 *     open/closed switch only gates customers, staff at the counter can still work.
 * The branch row is share-locked for the rest of the caller's transaction. */
export async function resolveBranchForStaffOperation(
  tx: Prisma.TransactionClient,
  params: { shopId: string; actorBranchId: string | null; requested: string | undefined },
): Promise<ResolvedBranch> {
  const { shopId, actorBranchId, requested } = params;
  let target: string | undefined;
  if (actorBranchId !== null) {
    if (requested !== undefined && requested !== actorBranchId) {
      throw new ForbiddenException("You can only work in your own branch.");
    }
    target = actorBranchId;
  } else {
    target = requested;
  }
  if (target === undefined) {
    const open = await tx.branch.findMany({
      where: { shopId, archivedAt: null },
      orderBy: [...OLDEST_FIRST],
      select: { id: true },
      take: 2,
    });
    if (open.length !== 1) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        "BRANCH_REQUIRED",
        "Choose which branch this is for.",
        false,
      );
    }
    target = open[0]!.id;
  }
  const branch = await lockBranch(tx, shopId, target);
  return { id: branch.id, name: branch.name };
}

/** The branch a CUSTOMER's order goes to (scanning a branch's QR code, or ordering from the web).
 *   - nothing named (a code printed before branches existed): the business's oldest non-archived
 *     branch, so those codes keep working;
 *   - the named branch must belong to this business (400 BRANCH_NOT_FOUND) and not be archived
 *     (409 BRANCH_ARCHIVED);
 *   - a closed branch (its own switch) refuses the order (409 BRANCH_CLOSED), while the business's
 *     other branches keep taking orders. The business-level status is a separate, earlier gate.
 * The branch row is share-locked for the rest of the caller's transaction. */
export async function resolveBranchForCustomerOrder(
  tx: Prisma.TransactionClient,
  params: { shopId: string; requested: string | undefined },
): Promise<ResolvedBranch> {
  const { shopId } = params;
  let target = params.requested;
  if (target === undefined) {
    const oldest = await tx.branch.findMany({
      where: { shopId, archivedAt: null },
      orderBy: [...OLDEST_FIRST],
      select: { id: true },
      take: 1,
    });
    if (oldest.length === 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        "BRANCH_NOT_FOUND",
        "This business has no branch open for orders.",
        false,
      );
    }
    target = oldest[0]!.id;
  }
  const branch = await lockBranch(tx, shopId, target);
  if (!branch.isOpen) {
    throw new AppException(
      HttpStatus.CONFLICT,
      "BRANCH_CLOSED",
      "This branch is closed right now.",
      false,
    );
  }
  return { id: branch.id, name: branch.name };
}
