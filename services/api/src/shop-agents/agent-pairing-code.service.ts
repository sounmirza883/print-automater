import { ForbiddenException, HttpStatus, Injectable } from "@nestjs/common";
import { AppException, AuditService, PrismaService } from "@print-automated/backend-shared";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { resolveBranchForStaffOperation } from "../branches/branch-resolution.js";
import { hashToken } from "../common/crypto.util.js";
import { generatePairingCode } from "./pairing-code.util.js";

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export interface PairingCodeIssueResult {
  code: string;
  expiresAt: Date;
  /** The branch the paired PC, and every printer it reports, will belong to. */
  branchId: string;
  branchName: string;
}

/** §41/9.2. `redeem()` is also called by 9.3's agent-registration
 * endpoint (a different module entirely -- agent requests carry no
 * staff JWT), which is why this lives in its own service rather than
 * inline in the shop-facing controller below. */
@Injectable()
export class AgentPairingCodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly audit: AuditService,
  ) {}

  /** A pairing code is for ONE branch: the paired PC and every printer it reports land there.
   * A branch-bound person's code is for their own branch (naming another is 403); otherwise the
   * named branch, or the business's only one (several and none named: 400 BRANCH_REQUIRED). */
  async issue(
    shopId: string,
    actorId: string,
    requestedBranchId?: string,
  ): Promise<PairingCodeIssueResult> {
    const actor = await this.shopMembership.getAccess(shopId, actorId);
    if (!actor) {
      throw new ForbiddenException("You do not have access to this shop.");
    }

    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
    const { record, branch } = await this.prisma.$transaction(async (tx) => {
      const resolved = await resolveBranchForStaffOperation(tx, {
        shopId,
        actorBranchId: actor.branchId,
        requested: requestedBranchId,
      });
      const created = await tx.agentPairingCode.create({
        data: {
          codeHash: hashToken(code),
          shopId,
          branchId: resolved.id,
          createdBy: actorId,
          expiresAt,
        },
      });
      return { record: created, branch: resolved };
    });

    // §45/16.6: pairing-code issue/redemption previously wrote no audit
    // row at all.
    await this.audit.record({
      actorId,
      action: AuditAction.PAIRING_CODE_ISSUED,
      resourceType: "agent_pairing_code",
      resourceId: record.id,
      metadata: { shopId, branchId: branch.id, expiresAt },
    });

    return { code, expiresAt, branchId: branch.id, branchName: branch.name };
  }

  /** §9.2's own Done-when: single-use (410 on a second redemption),
   * an expired code also 410. The `updateMany` claim (rather than a
   * plain `update`) is what makes two concurrent redemption attempts
   * of the same code resolve to exactly one winner -- a plain
   * read-then-write would let both readers see `consumedAt: null` and
   * both "succeed." Returns the shopId and branchId the code was issued for -- 9.3's
   * registration endpoint needs them to know which shop and branch the new device
   * belongs to. */
  async redeem(rawCode: string): Promise<{ shopId: string; branchId: string }> {
    const codeHash = hashToken(rawCode);
    const record = await this.prisma.agentPairingCode.findUnique({ where: { codeHash } });
    if (!record) {
      throw new AppException(
        HttpStatus.GONE,
        "PAIRING_CODE_INVALID",
        "This pairing code is invalid.",
        false,
      );
    }
    if (record.consumedAt !== null) {
      throw new AppException(
        HttpStatus.GONE,
        "PAIRING_CODE_CONSUMED",
        "This pairing code has already been used.",
        false,
      );
    }
    if (record.expiresAt.getTime() < Date.now()) {
      throw new AppException(
        HttpStatus.GONE,
        "PAIRING_CODE_EXPIRED",
        "This pairing code has expired.",
        false,
      );
    }

    // A code is for one branch. If that branch was archived since the code was issued, refuse
    // BEFORE consuming it (the branch row is share-locked until the claim commits, so it cannot be
    // archived in between), leaving the code unused: an owner can reuse nothing, but nothing is
    // burned either, and no agent ever registers into an archived branch.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const branch = await tx.$queryRaw<Array<{ archivedAt: Date | null }>>`
        SELECT archived_at AS "archivedAt" FROM branches WHERE id = ${record.branchId} FOR SHARE
      `;
      if (branch[0]?.archivedAt) {
        throw new AppException(
          HttpStatus.CONFLICT,
          "BRANCH_ARCHIVED",
          "The branch this code was issued for has been archived. Ask for a new code.",
          false,
        );
      }
      return tx.agentPairingCode.updateMany({
        where: { id: record.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
    });
    if (claimed.count === 0) {
      throw new AppException(
        HttpStatus.GONE,
        "PAIRING_CODE_CONSUMED",
        "This pairing code has already been used.",
        false,
      );
    }

    // §83: no authenticated human actor exists in this flow (the
    // printer agent redeeming the code has no staff JWT) -- actorId
    // null is the documented "system-initiated" shape, same as an
    // expiration worker.
    await this.audit.record({
      actorId: null,
      action: AuditAction.PAIRING_CODE_REDEEMED,
      resourceType: "agent_pairing_code",
      resourceId: record.id,
      metadata: { shopId: record.shopId, branchId: record.branchId },
    });

    return { shopId: record.shopId, branchId: record.branchId };
  }
}
