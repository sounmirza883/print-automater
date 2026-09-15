import { Injectable, Logger } from "@nestjs/common";

/**
 * STUB. Phase 7 replaces this with a real channel abstraction (SES/
 * MailHog email transport, queued via BullMQ, full event mapping per
 * §78). For now this exists only so 1.5's recovery endpoint has
 * somewhere to send the reset token -- it logs instead of emailing.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  sendPasswordRecovery(email: string, rawToken: string): void {
    this.logger.warn(
      `[STUB] Password recovery for ${email}: token=${rawToken} (Phase 7 will email this instead of logging it)`,
    );
  }
}
