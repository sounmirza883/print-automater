import { Injectable } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import type { EmailMessage, EmailTransport } from "./email-transport.interface.js";

export interface SmtpEmailTransportOptions {
  host: string;
  port: number;
  fromAddress: string;
  /** TLS on connect (SMTPS, typically port 465) vs. plain/STARTTLS
   * (typically 587 or 25). Most real relays (a transactional-email
   * provider's SMTP endpoint, a self-hosted Postfix/Exim, etc.) use
   * STARTTLS on 587 -- `secure: false` is nodemailer's own correct
   * default for that, matching MailhogEmailTransport's dev-only
   * `secure: false, ignoreTLS: true`. */
  secure?: boolean;
  /** Absent (MailHog, and some relays configured to trust the network
   * path) means no AUTH LOGIN/PLAIN exchange at all -- most real
   * relays require both. */
  auth?: { user: string; pass: string };
}

/** 14.5: the generic production email channel -- any standards-
 * compliant SMTP relay, not just AWS SES. Same `EmailTransport`
 * contract `MailhogEmailTransport` (dev, MailHog) and
 * `SesEmailTransport` (AWS-specific) already implement, selected the
 * same way by `EmailModule.forRoot()` via `EMAIL_TRANSPORT=smtp`.
 * This is what lets a production deployment (infrastructure/docker/
 * docker-compose.prod.yml, 14.3) point at any real relay without
 * requiring AWS at all -- the whole point of 14.5: SMTP no longer
 * implies SES. */
@Injectable()
export class SmtpEmailTransport implements EmailTransport {
  private readonly transporter: Transporter;
  private readonly fromAddress: string;

  constructor(options: SmtpEmailTransportOptions) {
    this.fromAddress = options.fromAddress;
    this.transporter = createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure ?? false,
      auth: options.auth,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
