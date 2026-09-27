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
