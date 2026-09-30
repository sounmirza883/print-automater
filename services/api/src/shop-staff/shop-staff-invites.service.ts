import { randomBytes, randomUUID } from "node:crypto";
import {
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ShopStaffStatus, UserRole, UserStatus, type Prisma } from "@prisma/client";
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
import type { AuthResult } from "../auth/auth.service.js";
import { PASSWORD_NOT_SET, PasswordService } from "../auth/password.service.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";
import { TokenService } from "../auth/token.service.js";
import { hashToken } from "../common/crypto.util.js";
import { maskEmail } from "../common/mask.js";
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

/** Fix wave 1: what activation answers -- a signed-in session (the same shape as login) plus
 * the business it opened and the role there, so a client can land the person straight in it. */
export interface ActivatedAccount extends AuthResult {
  shopId: string;
  role: UserRole;
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
 *    404, so the endpoint does not distinguish "no such token" from "wrong account".
 *  - Fix wave 1, admin-only onboarding: `issuePendingOwnerInviteWithin` (the one narrow
 *    exception to the authority rule above, for a platform admin creating a business) and
 *    `activateInvitedAccount` (unauthenticated: that business's owner, whose account has
 *    no password yet, sets one with the emailed code). */
@Injectable()
export class ShopStaffInvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopMembership: ShopMembershipService,
    private readonly shopStaff: ShopStaffService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
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
    const rawToken = await this.writeInvite(this.prisma, {
      shopId: input.shopId,
      email,
      role: input.role,
      invitedBy: actorId,
    });

    await this.notifications.sendStaffInvite(email, shop.name, input.role, rawToken);
    await this.recordInvited(actorId, input.shopId, input.role, email);
    return { result: "PROCESSED" };
  }

  /** Fix wave 1: THE one deliberate exception to `inviteByEmail`'s authority rule, and
   * narrow on purpose. A platform admin creating a business (AdminService) has no
   * membership there -- nobody does yet -- so `assertMayGrant` could never pass. Instead
   * of weakening that check for any caller, this separate method re-checks, inside the
   * caller's transaction, everything that makes the exception safe:
   *   - the actor's ACCOUNT role is ADMIN (defence in depth behind the controller's
   *     `@Roles(ADMIN)`);
   *   - the target is that business's owner-in-waiting: an ACTIVE SHOP_OWNER member
   *     whose account has no password yet (PASSWORD_NOT_SET) -- so even an admin cannot
   *     use this to hand ownership of a business to an arbitrary address, or to mint a
   *     code for someone who already signs in normally (409 OWNER_ALREADY_ACTIVE).
   * It writes (or refreshes, re-issuing the code and voiding the old one) a SHOP_OWNER
   * invitation for the owner's address, and returns what the caller needs to deliver it
   * AFTER its transaction commits (`deliverPendingOwnerInvite`). */
  async issuePendingOwnerInviteWithin(
    tx: Prisma.TransactionClient,
    adminActorId: string,
    input: { shopId: string; ownerUserId: string },
  ): Promise<{ rawToken: string; email: string; shopName: string }> {
    const [actor, ownerUser, membership, shop] = await Promise.all([
      tx.user.findUnique({ where: { id: adminActorId }, select: { role: true } }),
      tx.user.findUnique({
        where: { id: input.ownerUserId },
        select: { email: true, passwordHash: true },
      }),
      tx.shopStaff.findUnique({
        where: { shopId_userId: { shopId: input.shopId, userId: input.ownerUserId } },
        select: { role: true, status: true },
      }),
      tx.shop.findUnique({ where: { id: input.shopId }, select: { name: true } }),
    ]);
    if (actor?.role !== UserRole.ADMIN) {
      throw new ForbiddenException("Only a platform admin can issue a business owner's code.");
    }
    if (
      !ownerUser ||
      !shop ||
      membership?.role !== UserRole.SHOP_OWNER ||
      membership.status !== ShopStaffStatus.ACTIVE
    ) {
      throw new NotFoundException("This business has no owner waiting to activate.");
    }
    if (this.passwords.isPasswordSet(ownerUser.passwordHash)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        "OWNER_ALREADY_ACTIVE",
        "The owner has already set a password. They can sign in normally.",
        false,
      );
    }
    const email = ownerUser.email.trim().toLowerCase();
    const rawToken = await this.writeInvite(tx, {
      shopId: input.shopId,
      email,
      role: UserRole.SHOP_OWNER,
      invitedBy: adminActorId,
    });
    return { rawToken, email, shopName: shop.name };
  }

  /** The post-commit half of `issuePendingOwnerInviteWithin`: the set-your-password email,
   * and the same SHOP_STAFF_INVITED audit row (masked address) every invitation gets. */
  async deliverPendingOwnerInvite(
    adminActorId: string,
    shopId: string,
    issued: { rawToken: string; email: string; shopName: string },
  ): Promise<void> {
    await this.notifications.sendOwnerActivationInvite(
      issued.email,
      issued.shopName,
      issued.rawToken,
    );
    await this.recordInvited(adminActorId, shopId, UserRole.SHOP_OWNER, issued.email);
  }

  /** Fix wave 1: `POST /shop/staff-invites/activate` (unauthenticated). The owner of an
   * admin-created business proves the mailbox with the emailed code and chooses their own
   * password -- then is signed in. ONLY for an account that has never had a password
   * (PASSWORD_NOT_SET): for any other account this is refused exactly like a bad code, so
   * an invitation code is never a way to reset someone's password. Every refusal is the
   * same 404 as `acceptInvite`'s, so the endpoint reveals nothing about which part was
   * wrong. The invitation, the password and the membership check commit together. */
  async activateInvitedAccount(input: {
    email: string;
    token: string;
    password: string;
  }): Promise<ActivatedAccount> {
    const email = input.email.trim().toLowerCase();
    await this.enforceRateLimit(`invite-activate:${canonicalAddress(email)}`, 10);
    const [user, invite] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email },
        select: { id: true, name: true, email: true, role: true, status: true, passwordHash: true },
      }),
      this.prisma.shopStaffInvite.findUnique({ where: { tokenHash: hashToken(input.token) } }),
    ]);
    if (
      !user ||
      !invite ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.expiresAt.getTime() <= Date.now() ||
      invite.email !== email ||
      user.status !== UserStatus.ACTIVE ||
      this.passwords.isPasswordSet(user.passwordHash)
    ) {
      throw new NotFoundException(INVALID_INVITE);
    }

    // Hashed only once the code checked out (argon2id is deliberately expensive), and
    // outside the transaction so the rows below stay locked only briefly.
    const passwordHash = await this.passwords.hash(input.password);
    await this.prisma.$transaction(async (tx) => {
      // Matched on the token hash too: an admin re-issuing the code between the read above
      // and this claim re-tokens the same row, and the voided code must lose.
      const claimed = await tx.shopStaffInvite.updateMany({
        where: {
          id: invite.id,
          tokenHash: invite.tokenHash,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { acceptedAt: new Date() },
      });
      // The password may only replace the "not set yet" marker -- never a real one, even if
      // two activations race.
      const passwordSet = await tx.user.updateMany({
        where: { id: user.id, passwordHash: PASSWORD_NOT_SET, status: UserStatus.ACTIVE },
        data: { passwordHash },
      });
      const membership = await tx.shopStaff.findUnique({
        where: { shopId_userId: { shopId: invite.shopId, userId: user.id } },
        select: { role: true, status: true },
      });
      if (
        claimed.count !== 1 ||
        passwordSet.count !== 1 ||
        membership?.status !== ShopStaffStatus.ACTIVE ||
        membership.role !== invite.role
      ) {
        throw new NotFoundException(INVALID_INVITE);
      }
    });

    await this.audit.record({
      actorId: user.id,
      action: AuditAction.SHOP_STAFF_INVITE_ACCEPTED,
      resourceType: "shop_staff_invite",
      resourceId: invite.id,
      metadata: { shopId: invite.shopId, role: invite.role, invitedBy: invite.invitedBy },
    });
    await this.audit.record({
      actorId: user.id,
      action: AuditAction.ACCOUNT_ACTIVATED,
      resourceType: "user",
      resourceId: user.id,
      metadata: { shopId: invite.shopId },
    });
    const pair = await this.tokens.issueTokenPair(user);
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      shopId: invite.shopId,
      role: invite.role,
    };
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

  /** Records (or refreshes in place -- one row per business+address) a pending invitation
   * and returns the raw single-use code; only its hash is stored. Re-inviting re-tokens,
   * which voids any earlier code for the same business+address. */
  private async writeInvite(
    db: Prisma.TransactionClient,
    input: { shopId: string; email: string; role: UserRole; invitedBy: string },
  ): Promise<string> {
    const rawToken = randomBytes(32).toString("base64url");
    const data = {
      role: input.role,
      tokenHash: hashToken(rawToken),
      invitedBy: input.invitedBy,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      acceptedAt: null,
      revokedAt: null,
    };
    await db.shopStaffInvite.upsert({
      where: { shopId_email: { shopId: input.shopId, email: input.email } },
      create: { shopId: input.shopId, email: input.email, ...data },
      update: data,
    });
    return rawToken;
  }

  private async recordInvited(
    actorId: string,
    shopId: string,
    role: UserRole,
    email: string,
  ): Promise<void> {
    await this.audit.record({
      actorId,
      action: AuditAction.SHOP_STAFF_INVITED,
      resourceType: "shop_staff_invite",
      resourceId: shopId,
      // Never the address itself: a masked form is enough to recognise it in an audit review.
      metadata: { shopId, role, addressMasked: maskEmail(email) },
    });
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
