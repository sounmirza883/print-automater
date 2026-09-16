import "dotenv/config";
import { randomUUID } from "node:crypto";
import { MailhogEmailTransport } from "./mailhog-email-transport.js";

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
 * docker-compose.dev.yml) -- not mocked, since MailHog itself is
 * already the dev-safe stand-in for a real inbox (it catches, never
 * delivers). Verifies actual arrival via MailHog's own HTTP API, not
 * just that `sendMail()` resolved without throwing. */
describe("MailhogEmailTransport (7.2, integration)", () => {
  it("a sent email actually arrives at MailHog, readable via its HTTP API", async () => {
    const transport = new MailhogEmailTransport("no-reply@print-automated.dev", "localhost", 1025);
    const subject = `Test email ${randomUUID()}`;

    await transport.send({ to: "customer@print-automated.dev", subject, text: "Hello from 7.2." });

    const message = await findMessage(subject);
    expect(message).toBeDefined();
    expect(message?.Raw.To).toEqual(["customer@print-automated.dev"]);
    expect(message?.Content.Body).toContain("Hello from 7.2.");
  });
});
