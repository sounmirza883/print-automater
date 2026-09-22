import { DynamicModule, Global, Module } from "@nestjs/common";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { EMAIL_TRANSPORT, type EmailTransport } from "./email-transport.interface.js";
import { MailhogEmailTransport } from "./mailhog-email-transport.js";
import { SesEmailTransport } from "./ses-email-transport.js";
import { SmtpEmailTransport } from "./smtp-email-transport.js";

export type EmailModuleOptions =
  | { provider: "mailhog"; host: string; port: number; fromAddress: string }
  | { provider: "ses"; awsRegion: string; fromAddress: string }
  // 14.5: the generic production choice -- any standards-compliant
  // SMTP relay, not AWS-specific. `secure`/`auth` are optional the
  // same way SmtpEmailTransportOptions itself makes them optional
  // (MailHog needs neither; a real relay typically needs both).
  | {
      provider: "smtp";
      host: string;
      port: number;
      fromAddress: string;
      secure?: boolean;
      auth?: { user: string; pass: string };
    };

/** forRoot(), same reasoning as KmsModule/RedisModule/StorageModule --
 * each app resolves its own env (EMAIL_TRANSPORT, SMTP_HOST/PORT or
 * AWS region) before calling this, so the module itself stays agnostic
 * to which app is calling it. */
@Global()
@Module({})
export class EmailModule {
  static forRoot(options: EmailModuleOptions): DynamicModule {
    return {
      module: EmailModule,
      providers: [
        {
          provide: EMAIL_TRANSPORT,
          useFactory: (): EmailTransport => {
            switch (options.provider) {
              case "ses":
                return new SesEmailTransport(
                  new SESv2Client({ region: options.awsRegion }),
                  options.fromAddress,
                );
              case "smtp":
                return new SmtpEmailTransport({
                  host: options.host,
                  port: options.port,
                  fromAddress: options.fromAddress,
                  secure: options.secure,
                  auth: options.auth,
                });
              case "mailhog":
                return new MailhogEmailTransport(options.fromAddress, options.host, options.port);
            }
          },
        },
      ],
      exports: [EMAIL_TRANSPORT],
    };
  }
}
