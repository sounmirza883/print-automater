import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { QUEUE_NAMES, type SendEmailJob } from "@print-automated/backend-shared";

/** 7.2 replaced the Phase-1 stub (log instead of email) with the real
 * thing: enqueue, never send synchronously -- §78's "never blocking a
 * state transition" applies just as much to this call site as it does
 * to 7.3's order-event notifications. A transport failure retries
 * (services/worker's processor, SEND_EMAIL_JOB_OPTIONS's backoff)
 * without this call -- or whatever triggered it -- ever knowing or
 * waiting for that outcome. */
@Injectable()
export class NotificationService {
  constructor(
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS)
    private readonly notificationsQueue: Queue<SendEmailJob>,
  ) {}

  async sendPasswordRecovery(email: string, rawToken: string): Promise<void> {
    await this.notificationsQueue.add("send-email", {
      to: email,
      subject: "Reset your Print Automated password",
      text: `Use this code to reset your password: ${rawToken}\n\nIf you didn't request this, you can ignore this email.`,
    });
  }

  /** 23.15/23.18: sent for EVERY add-by-email -- always an invitation with a single-use code,
   * whether or not the address has an account (membership needs the code). The business name
   * is owner-controlled text inside a platform-branded email, so it is sanitised here too. */
  async sendStaffInvite(
    email: string,
    shopName: string,
    role: string,
    rawToken: string,
  ): Promise<void> {
    const name = sanitizeShopNameForEmail(shopName);
    await this.notificationsQueue.add(
      "send-email",
      {
        to: email,
        subject: "Your invitation on Print Automated",
        text: `You have been invited to join a business on Print Automated as ${role}.

Business name (as entered by the business): "${name}"

Sign in (or create an account with this email address) and enter this code under "Accept invitation": ${rawToken}

The code expires in 7 days. If you were not expecting this, ignore this email.`,
      },
      // 23.18: the job carries a live invitation code; do not keep it in Redis once handled.
      { removeOnComplete: true, removeOnFail: true },
    );
  }

  /** Fix wave 1: sent when a platform admin creates a business and names its owner. The
   * owner's account already exists but has no password (PASSWORD_NOT_SET); this code is
   * how they prove the mailbox and choose one (POST /shop/staff-invites/activate). Same
   * sanitising and same no-copy-in-Redis handling as a staff invitation. */
  async sendOwnerActivationInvite(
    email: string,
    shopName: string,
    rawToken: string,
  ): Promise<void> {
    const name = sanitizeShopNameForEmail(shopName);
    await this.notificationsQueue.add(
      "send-email",
      {
        to: email,
        subject: "Your business is ready on Print Automated",
        text: `A Print Automated administrator has set up a business with you as its owner.

Business name: "${name}"

To set your password and sign in, open the Print Automated back office, choose "Set up your account", and enter your email address with this code: ${rawToken}

The code expires in 7 days. If you were not expecting this, ignore this email.`,
      },
      { removeOnComplete: true, removeOnFail: true },
    );
  }

  /** Plan-payment proof reviewed: tells the submitting owner the outcome. Carries no
   * secret, so the job is kept like any other email. The business name is
   * owner-controlled, so it is sanitised; the rejection reason is written by a platform
   * admin. */
  async sendPaymentProofDecision(
    email: string,
    shopName: string,
    decision:
      | { approved: true; planName: string; months: number; expiresAt: Date }
      | { approved: false; reason: string },
  ): Promise<void> {
    const name = sanitizeShopNameForEmail(shopName);
    const text = decision.approved
      ? `Your payment for "${name}" was approved.

Plan: ${decision.planName}
Access added: ${decision.months} month${decision.months === 1 ? "" : "s"}
Active until: ${decision.expiresAt.toISOString().slice(0, 10)}

Thank you.`
      : `Your payment proof for "${name}" was not approved.

Reason: ${decision.reason}

You can submit a new proof from the Billing screen.`;
    await this.notificationsQueue.add("send-email", {
      to: email,
      subject: decision.approved
        ? "Your Print Automated payment was approved"
        : "Your Print Automated payment proof was not approved",
      text,
    });
  }
}

const SHOP_NAME_MAX = 60;

/** C0/C1 controls, Unicode line/paragraph separators and bidi overrides/isolates: line breaks
 * enable header/body injection, bidi controls let text display differently from what it is. */
function isUnsafeChar(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** 23.18: owner-controlled business name made safe for an email: no control characters or
 * line breaks (header/body injection), no URLs (no attacker links in a platform email), no
 * markup characters, capped length, and a neutral fallback if nothing is left. */
export function sanitizeShopNameForEmail(name: string): string {
  const cleaned = Array.from(name, (ch) => (isUnsafeChar(ch.codePointAt(0)!) ? " " : ch))
    .join("")
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S*/gi, " ")
    .replace(/\bwww\.\S*/gi, " ")
    .replace(/[<>`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SHOP_NAME_MAX)
    .trim();
  return cleaned.length > 0 ? cleaned : "a business";
}
