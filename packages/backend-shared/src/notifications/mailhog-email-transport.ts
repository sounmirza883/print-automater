import { Injectable } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import type { EmailMessage, EmailTransport } from "./email-transport.interface.js";

/** Dev-only: plain SMTP to the local MailHog container
 * (infrastructure/docker/docker-compose.dev.yml, port 1025) -- MailHog
 * never actually delivers anything, it just catches and displays what
 * was sent (its own UI/HTTP API on 8025), which is exactly what makes
 * it safe to point real application code at in dev without a real
 * inbox on the other end. */
@Injectable()
export class MailhogEmailTransport implements EmailTransport {
  private readonly transporter: Transporter;

  constructor(
    private readonly fromAddress: string,
    host: string,
    port: number,
  ) {
    this.transporter = createTransport({ host, port, secure: false, ignoreTLS: true });
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
