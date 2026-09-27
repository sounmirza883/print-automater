import { randomBytes, randomUUID } from "node:crypto";
import {
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { UserRole } from "@prisma/client";
import {
  AppException,
  AuditService,
  PrismaService,
  REDIS_CLIENT,
  type RedisWithRateLimit,
} from "@print-automated/backend-shared";
import type { Page } from "@print-automated/types";
import type { ListStaffInvitesQueryInput } from "@print-automated/validation";
import { AuditAction } from "../audit/audit-action.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { hashToken } from "../common/crypto.util.js";
import { NotificationService } from "../notifications/notification.service.js";
import { canonicalAddress } from "./email-address.js";
import { roleRank } from "./role-rank.js";
import { ShopStaffService } from "./shop-staff.service.js";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
/** Per inviting person: bounds how fast anyone can probe or spam through this endpoint. */
export const INVITES_PER_ACTOR_PER_HOUR = 20;
/** Per (business, mailbox): a mailbox is identified by `canonicalAddress` so a plus-tag or a
 * Gmail dot cannot buy a fresh budget (23.18). */
export const INVITES_PER_SHOP_EMAIL_PER_HOUR = 3;
/** Per mailbox ACROSS every business: higher than the per-business cap (several businesses
 * legitimately inviting the same person is normal) but still bounded, so one malicious owner
 * cannot exhaust an address's budget and block every other business from inviting it (23.18). */
export const INVITES_PER_EMAIL_PER_HOUR = 10;

/** The one response an add-by-email ever produces (HTTP 202): the caller must not learn
 * whether the address has an account (23.18: both cases create a pending invitation). */
export interface StaffInviteProcessed {
  result: "PROCESSED";
}

export interface StaffInviteListItem {
  id: string;
  email: string;
  role: UserRole;
  invitedBy: string | null;
  createdAt: Date;
  expiresAt: Date;
}

const INVALID_INVITE = "This invitation is invalid or has expired.";

/** 23.15. Add a person to a business by email.
 *
 *  - `inviteByEmail` (MANAGE_USERS at the business): checks the caller may grant that role
 *    (and, when replacing a pending invitation, that one's role), rate-limits, then records a
 *    pending invitation and emails a single-use token -- ALWAYS, even if an account already
 *    holds the address (23.18: registration does not verify email, so an account is not
 *    consent). Same email, same 202 body, same stored state either way.
 *  - `acceptInvite` (any signed-in account): needs the emailed token AND the account's own
 *    email to equal the invited address, so merely registering an invited address grants
 *    nothing. The membership is created with the INVITER's authority, re-checked at accept time
 *    (a demoted or removed inviter's invitation no longer works). Every failure is the same
 *    404, so the endpoint does not distinguish "no such token" from "wrong account". */
@Injectable()
export class ShopStaffInvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly shopStaff: ShopStaffService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisWithRateLimit,
  ) {}

  async inviteByEmail(
    actorId: string,
    input: { shopId: string; email: string; role: UserRole },
  ): Promise<StaffInviteProcessed> {
    const email = input.email.trim().toLowerCase();
    const mailbox = canonicalAddress(email);
    // Authority first (also proves the caller is active staff here): a caller who could not
    // grant this role gets 403 before anything about the address is looked up or any
    // rate-limit budget is spent.
    await this.shopStaff.assertMayGrant(actorId, input.shopId, input.role);
    // 23.18: replacing a still-pending invitation needs authority over ITS role too, so a
    // manager cannot silently downgrade (or re-token) an owner-level invitation.
    const existing = await this.prisma.shopStaffInvite.findUnique({
      where: { shopId_email: { shopId: input.shopId, email } },
      select: { role: true, acceptedAt: true, revokedAt: true, expiresAt: true },
    });
    if (
      existing &&
      !existing.acceptedAt &&
      !existing.revokedAt &&
      existing.expiresAt.getTime() > Date.now()
    ) {
      const actorRole = await this.shopMembership.getEffectiveRole(input.shopId, actorId);
      if (!actorRole || roleRank(existing.role) > roleRank(actorRole)) {
        throw new ForbiddenException(
          "You cannot replace a pending invitation for a role above your own.",
        );
      }
    }
    await this.enforceRateLimit(`invite:actor:${actorId}`, INVITES_PER_ACTOR_PER_HOUR);
    await this.enforceRateLimit(
      `invite:shop-email:${input.shopId}:${mailbox}`,
      INVITES_PER_SHOP_EMAIL_PER_HOUR,
    );
    await this.enforceRateLimit(`invite:email:${mailbox}`, INVITES_PER_EMAIL_PER_HOUR);

    const shop = await this.prisma.shop.findUniqueOrThrow({
      where: { id: input.shopId },
      select: { name: true },
    });

    // 23.18: ALWAYS a pending invitation, never a direct add -- even when an account already
    // holds this address. Registration does not verify email, so "an account with this
    // address exists" is not consent (anyone can register an address they do not own); only
    // the emailed token proves control of the mailbox. Doing identical work for both cases
    // also removes the side channel (the account never appears in the roster before it
    // accepts, the audit row and timing are the same).
    const rawToken = randomBytes(32).toString("base64url");
    const data = {
      role: input.role,
      tokenHash: hashToken(rawToken),
      invitedBy: actorId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      acceptedAt: null,
      revokedAt: null,
    };
    await this.prisma.shopStaffInvite.upsert({
      where: { shopId_email: { shopId: input.shopId, email } },
      create: { shopId: input.shopId, email, ...data },
      update: data,
    });

    await this.notifications.sendStaffInvite(email, shop.name, input.role, rawToken);
    await this.audit.record({
      actorId,
      action: AuditAction.SHOP_STAFF_INVITED,
      resourceType: "shop_staff_invite",
      resourceId: input.shopId,
      // Never the address itself: a masked form is enough to recognise it in an audit review.
      metadata: { shopId: input.shopId, role: input.role, addressMasked: maskEmail(email) },
    });
    return { result: "PROCESSED" };
  }

  async acceptInvite(
    userId: string,
    rawToken: string,
  ): Promise<{ shopId: string; role: UserRole }> {
    await this.enforceRateLimit(`invite-accept:${userId}`, 10);
    const [user, invite] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
      this.prisma.shopStaffInvite.findUnique({ where: { tokenHash: hashToken(rawToken) } }),
    ]);
    if (
      !user ||
      !invite ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.expiresAt.getTime() <= Date.now() ||
      invite.invitedBy === null ||
      user.email.toLowerCase() !== invite.email
    ) {
      throw new NotFoundException(INVALID_INVITE);
    }

    // 23.18: claim (single winner) and add in ONE transaction, so a refused add -- or a crash
    // between the two -- can never leave a consumed invitation with no membership, and a
    // concurrent revoke sees either "still pending" or "accepted", never a half state.
    const inviter = invite.invitedBy;
    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.shopStaffInvite.updateMany({
          where: { id: invite.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: new Date() },
        });
        if (claimed.count !== 1) {
          throw new NotFoundException(INVALID_INVITE);
        }
        await this.shopStaff.addStaffWithin(tx, inviter, {
          shopId: invite.shopId,
          userId,
          role: invite.role,
        });
      });
    } catch (error) {
      if (error instanceof ForbiddenException) {
        // The inviter lost the authority to grant this (demoted, removed, or the addressee
        // already holds a higher role): the invitation is simply no longer valid.
        throw new NotFoundException(INVALID_INVITE);
      }
      throw error;
    }
    await this.audit.record({
      actorId: userId,
      action: AuditAction.SHOP_STAFF_INVITE_ACCEPTED,
      resourceType: "shop_staff_invite",
      resourceId: invite.id,
      metadata: { shopId: invite.shopId, role: invite.role, invitedBy: invite.invitedBy },
    });
    return { shopId: invite.shopId, role: invite.role };
  }

  /** Pending (unaccepted, unrevoked, unexpired) invitations of one business, newest first. */
  async listPending(
    actorId: string,
    query: ListStaffInvitesQueryInput,
  ): Promise<Page<StaffInviteListItem>> {
    await this.assertMember(query.shopId, actorId);
    const where = {
      shopId: query.shopId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    };
    const [rows, total] = await Promise.all([
      this.prisma.shopStaffInvite.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: query.limit,
        skip: query.offset,
        select: {
          id: true,
          email: true,
          role: true,
          invitedBy: true,
          createdAt: true,
          expiresAt: true,
        },
      }),
      this.prisma.shopStaffInvite.count({ where }),
    ]);
    return { items: rows, total, limit: query.limit, offset: query.offset };
  }

  /** Cancels a pending invitation. A non-owner cannot cancel one for a role above their own. */
  async revoke(inviteId: string, actorId: string): Promise<void> {
    const invite = await this.prisma.shopStaffInvite.findUnique({ where: { id: inviteId } });
    if (!invite) {
      throw new NotFoundException("No such invitation.");
    }
    const actorRole = await this.shopMembership.getEffectiveRole(invite.shopId, actorId);
    if (!actorRole || roleRank(invite.role) > roleRank(actorRole)) {
      throw new ForbiddenException("You cannot cancel an invitation for a role above your own.");
    }
    // 23.18: decided by the conditional write, not the earlier read, so a revoke racing an
    // accept cannot report success (and audit a revocation) for an invitation that was used.
    const revoked = await this.prisma.shopStaffInvite.updateMany({
      where: { id: inviteId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "SHOP_STAFF_INVITE_NOT_PENDING",
        "This invitation was already accepted or cancelled.",
        false,
      );
    }
    await this.audit.record({
      actorId,
      action: AuditAction.SHOP_STAFF_INVITE_REVOKED,
      resourceType: "shop_staff_invite",
      resourceId: inviteId,
      metadata: { shopId: invite.shopId, role: invite.role },
    });
  }

  private async assertMember(shopId: string, userId: string): Promise<void> {
    if (!(await this.shopMembership.isActiveStaff(shopId, userId))) {
      throw new ForbiddenException("You do not have access to this shop's staff.");
    }
  }

  private async enforceRateLimit(key: string, limit: number): Promise<void> {
    const now = Date.now();
    const [allowed, , retryAfterMs] = await this.redis.slidingWindowRateLimit(
      `ratelimit:staff:${key}`,
      now,
      HOUR_MS,
      limit,
      `${now}:${randomUUID()}`,
    );
    if (allowed === 0) {
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        "RATE_LIMITED",
        `Too many invitations. Try again in ${Math.max(1, Math.ceil(retryAfterMs / 60_000))} minute(s).`,
        true,
      );
    }
  }
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
