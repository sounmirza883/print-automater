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

  /** 23.15: sent for EVERY add-by-email, whether or not the address has an account, so the
   * caller-visible behaviour (and the side effects) do not reveal which. `rawToken` is set only
   * when an invitation was created; an existing account is simply told it now has access. */
  async sendStaffInvite(
    email: string,
    shopName: string,
    role: string,
    rawToken: string | null,
  ): Promise<void> {
    const text = rawToken
      ? `You have been invited to join ${shopName} as ${role}.

Sign in (or create an account with this email address) and enter this code under "Accept invitation": ${rawToken}

The code expires in 7 days. If you were not expecting this, ignore this email.`
      : `You have been added to ${shopName} as ${role}. Sign in to see it.

If you were not expecting this, contact the business.`;
    await this.notificationsQueue.add("send-email", {
      to: email,
      subject: `Your access to ${shopName} on Print Automated`,
      text,
    });
  }
}
