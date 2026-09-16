export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/** §78's MVP email channel, abstracted the same way 2.2's
 * KeyManagementService abstracts KMS: callers depend on this interface
 * only, never a concrete transport. `MailhogEmailTransport` (dev, real
 * SMTP to the local MailHog container) and `SesEmailTransport` (prod,
 * real AWS SES) are selected by `EmailModule.forRoot()` based on each
 * app's own `EMAIL_TRANSPORT` env value -- the same shape KmsModule
 * already uses for KMS_PROVIDER. */
export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_TRANSPORT = Symbol("EMAIL_TRANSPORT");
