import { Injectable } from "@nestjs/common";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import type { EmailMessage, EmailTransport } from "./email-transport.interface.js";

/** Prod: real AWS SES via its v2 API's `Simple` content shape (a
 * subject + a text body, no MIME construction needed for §78's plain-
 * text MVP notifications). */
@Injectable()
export class SesEmailTransport implements EmailTransport {
  constructor(
    private readonly client: SESv2Client,
    private readonly fromAddress: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.fromAddress,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject },
            Body: { Text: { Data: message.text } },
          },
        },
      }),
    );
  }
}
