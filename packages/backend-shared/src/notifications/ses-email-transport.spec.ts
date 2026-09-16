import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { mockClient } from "aws-sdk-client-mock";
import { SesEmailTransport } from "./ses-email-transport.js";

// No real AWS account is available in this environment (12.7/12.8 wire
// real credentials once staging exists) -- mocks SESv2Client.send()
// directly, same pattern aws-kms.provider.spec.ts already uses for
// KMSClient, verifying the exact request shape rather than trusting a
// canned "it worked" response.
const sesMock = mockClient(SESv2Client);

describe("SesEmailTransport (7.2)", () => {
  beforeEach(() => {
    sesMock.reset();
  });

  it("sends a SendEmailCommand with the correct from/to/subject/text shape", async () => {
    sesMock.on(SendEmailCommand).resolves({ MessageId: "msg-1" });
    const transport = new SesEmailTransport(
      sesMock as unknown as SESv2Client,
      "no-reply@print-automated.dev",
    );

    await transport.send({
      to: "customer@print-automated.dev",
      subject: "Your order is ready",
      text: "Come collect it.",
    });

    expect(sesMock.calls()).toHaveLength(1);
    const input = sesMock.call(0).args[0].input;
    expect(input).toEqual({
      FromEmailAddress: "no-reply@print-automated.dev",
      Destination: { ToAddresses: ["customer@print-automated.dev"] },
      Content: {
        Simple: {
          Subject: { Data: "Your order is ready" },
          Body: { Text: { Data: "Come collect it." } },
        },
      },
    });
  });

  it("propagates a transport failure rather than swallowing it -- 7.2's own retry guarantee depends on this actually throwing", async () => {
    sesMock.on(SendEmailCommand).rejects(new Error("SES throttled"));
    const transport = new SesEmailTransport(
      sesMock as unknown as SESv2Client,
      "no-reply@print-automated.dev",
    );

    await expect(
      transport.send({ to: "customer@print-automated.dev", subject: "x", text: "y" }),
    ).rejects.toThrow("SES throttled");
  });
});
