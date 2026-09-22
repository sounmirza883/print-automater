import "dotenv/config";
import { randomUUID } from "node:crypto";
import { SmtpEmailTransport } from "./smtp-email-transport.js";

const MAILHOG_HTTP_URL = "http://localhost:8025";

interface MailhogMessage {
  Content: { Headers: Record<string, string[]>; Body: string };
  Raw: { To: string[] };
}

async function findMessage(subject: string): Promise<MailhogMessage | undefined> {
  const res = await fetch(
    `${MAILHOG_HTTP_URL}/api/v2/search?kind=containing&query=${encodeURIComponent(subject)}`,
  );
  const body = (await res.json()) as { items: MailhogMessage[] };
  return body.items[0];
}

/** Against the real MailHog container (infrastructure/docker/
 * docker-compose.dev.yml) -- same integration approach as
 * mailhog-email-transport.spec.ts, but exercising the new generic
 * SmtpEmailTransport (14.5) instead: MailHog speaks plain SMTP, so it
 * doubles as a real, standards-compliant relay to prove this class
 * against, not just a MailHog-specific stand-in. Production points
 * the exact same class at a real relay (host/port/auth/secure only --
 * see infrastructure/docker/README.md's "SMTP relay" section). */
describe("SmtpEmailTransport (14.5, integration)", () => {
  it("a sent email actually arrives at the SMTP relay, readable via MailHog's HTTP API", async () => {
    const transport = new SmtpEmailTransport({
      host: "localhost",
      port: 1025,
      fromAddress: "no-reply@print-automated.dev",
      secure: false,
    });
    const subject = `Test email ${randomUUID()}`;

    await transport.send({ to: "customer@print-automated.dev", subject, text: "Hello from 14.5." });

    const message = await findMessage(subject);
    expect(message).toBeDefined();
    expect(message?.Raw.To).toEqual(["customer@print-automated.dev"]);
    expect(message?.Content.Body).toContain("Hello from 14.5.");
  });

  it("propagates a transport failure rather than swallowing it -- a bad host must actually throw, matching SesEmailTransport's own guarantee", async () => {
    const transport = new SmtpEmailTransport({
      host: "localhost",
      // Nothing listens on this port in the dev stack -- a real
      // connection failure, not a mocked one.
      port: 1,
      fromAddress: "no-reply@print-automated.dev",
      secure: false,
    });

    await expect(
      transport.send({ to: "customer@print-automated.dev", subject: "x", text: "y" }),
    ).rejects.toThrow();
  }, 15000);
});
