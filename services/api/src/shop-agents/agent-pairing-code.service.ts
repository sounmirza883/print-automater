import { ForbiddenException, HttpStatus, Injectable } from "@nestjs/common";
import { AppException, AuditService, PrismaService } from "@print-automated/backend-shared";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { hashToken } from "../common/crypto.util.js";
import { generatePairingCode } from "./pairing-code.util.js";

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export interface PairingCodeIssueResult {
  code: string;
  expiresAt: Date;
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

  async issue(shopId: string, actorId: string): Promise<PairingCodeIssueResult> {
    const isMember = await this.shopMembership.isActiveStaff(shopId, actorId);
    if (!isMember) {
      throw new ForbiddenException("You do not have access to this shop.");
    }

    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
    const record = await this.prisma.agentPairingCode.create({
      data: { codeHash: hashToken(code), shopId, createdBy: actorId, expiresAt },
    });

    // §45/16.6: pairing-code issue/redemption previously wrote no audit
    // row at all.
    await this.audit.record({
      actorId,
      action: AuditAction.PAIRING_CODE_ISSUED,
      resourceType: "agent_pairing_code",
      resourceId: record.id,
      metadata: { shopId, expiresAt },
    });

    return { code, expiresAt };
  }

  /** §9.2's own Done-when: single-use (410 on a second redemption),
   * an expired code also 410. The `updateMany` claim (rather than a
   * plain `update`) is what makes two concurrent redemption attempts
   * of the same code resolve to exactly one winner -- a plain
   * read-then-write would let both readers see `consumedAt: null` and
   * both "succeed." Returns the shopId the code was issued for -- 9.3's
   * registration endpoint needs it to know which shop the new device
   * belongs to. */
  async redeem(rawCode: string): Promise<{ shopId: string }> {
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

    const claimed = await this.prisma.agentPairingCode.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
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
      metadata: { shopId: record.shopId },
    });

    return { shopId: record.shopId };
  }
}
