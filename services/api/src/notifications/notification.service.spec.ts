import type { Queue } from "bullmq";
import type { SendEmailJob } from "@print-automated/backend-shared";
import { NotificationService, sanitizeShopNameForEmail } from "./notification.service.js";

describe("NotificationService.sendOwnerActivationInvite (fix wave 1)", () => {
  it("emails the new owner their single-use code with set-your-password wording, and keeps no copy in Redis", async () => {
    const add = jest.fn().mockResolvedValue(undefined);
    const service = new NotificationService({ add } as unknown as Queue<SendEmailJob>);

    await service.sendOwnerActivationInvite(
      "owner@example.com",
      "Corner Copies\r\nBcc: x@y.z",
      "the-raw-code",
    );

    expect(add).toHaveBeenCalledTimes(1);
    const [name, job, options] = add.mock.calls[0] as [string, SendEmailJob, unknown];
    expect(name).toBe("send-email");
    expect(job.to).toBe("owner@example.com");
    expect(job.text).toContain("the-raw-code");
    expect(job.text).toContain("Corner Copies Bcc: x@y.z");
    expect(job.text).toContain("set your password");
    expect(job.text).toContain("7 days");
    expect(job.subject).not.toMatch(/[\r\n]/);
    expect(options).toEqual({ removeOnComplete: true, removeOnFail: true });
  });
});

describe("sanitizeShopNameForEmail (23.18)", () => {
  it("strips control characters, newlines, URLs and markup, and caps the length", () => {
    const out = sanitizeShopNameForEmail(
      "Evil\r\nBcc: x@y.z <b>Shop</b> https://phish.example/login www.phish.example `x`",
    );
    for (const code of [0x85, 0x2028, 0x2029, 0x202e, 0x2066, 0x2069]) {
      expect(out).not.toContain(String.fromCharCode(code));
    }
    expect(out).not.toContain("http");
    expect(out).not.toContain("www.");
    expect(sanitizeShopNameForEmail("a".repeat(500)).length).toBeLessThanOrEqual(60);
  });

  it("removes C1 controls, Unicode line separators and bidi overrides", () => {
    const hostile = [
      "Shop",
      String.fromCharCode(0x85),
      "A",
      String.fromCharCode(0x2028),
      "B",
      String.fromCharCode(0x2029),
      "C",
      String.fromCharCode(0x202e),
      "gnp.exe",
      String.fromCharCode(0x2066),
      "D",
      String.fromCharCode(0x2069),
    ].join("");
    const out = sanitizeShopNameForEmail(hostile);
    for (const code of [0x85, 0x2028, 0x2029, 0x202e, 0x2066, 0x2069]) {
      expect(out).not.toContain(String.fromCharCode(code));
    }
    expect(out).toBe("Shop A B C gnp.exe D");
  });

  it("keeps an ordinary name intact and falls back when nothing is left", () => {
    expect(sanitizeShopNameForEmail("Ali's Print Shop")).toBe("Ali's Print Shop");
    expect(sanitizeShopNameForEmail("https://only.example")).toBe("a business");
  });
});
