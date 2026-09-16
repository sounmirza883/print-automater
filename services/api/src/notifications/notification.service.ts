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
}
