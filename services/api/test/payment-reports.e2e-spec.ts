import { randomUUID } from "node:crypto";
import { UserRole } from "@prisma/client";
import request from "supertest";
import { TokenService } from "../src/auth/token.service.js";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

/** Admin payment reports: money received (approved) vs not accepted (rejected) over a range, and
 * its CSV / Excel export. Every payment is seeded in March 2020 so the numbers cannot mix with
 * real proofs that live in the same development database. */
describe("Payment reports (e2e)", () => {
  let fx: Fx;
  let adminToken: string;
  let starterId: string;
  let growthId: string;
  const extraUserIds: string[] = [];
  const FROM = "2020-03-01T00:00:00.000Z";
  const TO = "2020-04-01T00:00:00.000Z";

  beforeAll(async () => {
    fx = await createPhase19Fixture("payment-reports", { multiItemEnabled: false });
    const admin = await fx.prisma.user.create({
      data: {
        role: UserRole.ADMIN,
        name: "Reports E2E Admin",
        email: `reports-e2e-admin-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    extraUserIds.push(admin.id);
    adminToken = fx.app.get(TokenService).issueAccessToken(admin);

    const starter = await fx.prisma.planDefinition.create({
      data: {
        name: `Reports E2E Starter ${randomUUID()}`,
        priceMinor: 600_000,
        currency: "PKR",
        billingPeriodDays: 30,
      },
    });
    const growth = await fx.prisma.planDefinition.create({
      data: {
        name: `Reports E2E Growth ${randomUUID()}`,
        priceMinor: 1_200_000,
        currency: "PKR",
        billingPeriodDays: 30,
      },
    });
    starterId = starter.id;
    growthId = growth.id;

    const base = {
      shopId: fx.shop.id,
      submittedByUserId: admin.id,
      currency: "PKR",
      fileKey: "payment-proofs/not-a-real-object",
      fileName: "r.png",
      fileContentType: "image/png",
      fileSize: 1,
    };
    const decided = { reviewedByUserId: admin.id };
    await fx.prisma.paymentProof.createMany({
      data: [
        // Received: 6,000 on 5 Mar, 12,000 on 5 Mar (late evening UTC = 6 Mar in Pakistan).
        {
          ...base,
          ...decided,
          planDefinitionId: starterId,
          amountMinor: 600_000,
          transactionRef: "R-1",
          status: "APPROVED",
          grantedMonths: 1,
          createdAt: new Date("2020-03-04T08:00:00Z"),
          reviewedAt: new Date("2020-03-05T08:00:00Z"),
        },
        {
          ...base,
          ...decided,
          planDefinitionId: growthId,
          amountMinor: 1_200_000,
          transactionRef: "=cmd|' /C calc'!A0",
          status: "APPROVED",
          grantedMonths: 12,
          createdAt: new Date("2020-03-05T09:00:00Z"),
          reviewedAt: new Date("2020-03-05T21:00:00Z"),
        },
        // Not accepted: 5,000 on 10 Mar.
        {
          ...base,
          ...decided,
          planDefinitionId: starterId,
          amountMinor: 500_000,
          transactionRef: "R-3",
          status: "REJECTED",
          rejectionReason: "Amount does not match",
          createdAt: new Date("2020-03-09T08:00:00Z"),
          reviewedAt: new Date("2020-03-10T08:00:00Z"),
        },
        // Outside the range: decided in April.
        {
          ...base,
          ...decided,
          planDefinitionId: starterId,
          amountMinor: 999_900,
          transactionRef: "R-4",
          status: "APPROVED",
          grantedMonths: 1,
          createdAt: new Date("2020-03-30T08:00:00Z"),
          reviewedAt: new Date("2020-04-02T08:00:00Z"),
        },
        // Waiting: submitted 20 Mar (one pending per shop is a database rule).
        {
          ...base,
          planDefinitionId: growthId,
          amountMinor: 700_000,
          transactionRef: "R-5",
          status: "PENDING",
          createdAt: new Date("2020-03-20T08:00:00Z"),
        },
      ],
    });
  });

  afterAll(async () => {
    await fx.prisma.paymentProof.deleteMany({ where: { shopId: fx.shop.id } });
    await fx.prisma.planDefinition.deleteMany({ where: { id: { in: [starterId, growthId] } } });
    await fx.prisma.auditLog.deleteMany({ where: { actorId: { in: extraUserIds } } });
    await fx.prisma.user.deleteMany({ where: { id: { in: extraUserIds } } });
    await fx?.cleanup();
  });

  const http = () => request(fx.app.getHttpServer());
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });
  const owner = () => ({ Authorization: `Bearer ${fx.token}` });
  const range = `from=${FROM}&to=${TO}`;

  it("totals money received vs not accepted for the range, with waiting kept apart", async () => {
    const res = await http().get(`/v1/admin/payment-reports?${range}`).set(admin());
    expect(res.status).toBe(200);
    expect(res.body.groupBy).toBe("day"); // a 31-day range reports per day
    expect(res.body.currencies).toHaveLength(1);
    const pkr = res.body.currencies[0];
    expect(pkr).toMatchObject({
      currency: "PKR",
      receivedMinor: 1_800_000,
      receivedCount: 2,
      rejectedMinor: 500_000,
      rejectedCount: 1,
      waitingMinor: 700_000,
      waitingCount: 1,
    });
    expect(pkr.periods).toHaveLength(31);
    expect(pkr.periods.find((p: { period: string }) => p.period === "2020-03-05")).toMatchObject({
      receivedMinor: 1_800_000,
    });
    expect(pkr.byPlan.map((p: { receivedMinor: number }) => p.receivedMinor)).toEqual([
      1_200_000, 600_000,
    ]);
  });

  it("counts days in the viewer's time zone (Pakistan, +5h): the 21:00 UTC approval is the next day", async () => {
    const res = await http()
      .get(
        `/v1/admin/payment-reports?from=2020-02-29T19:00:00.000Z&to=2020-03-31T19:00:00.000Z&tzOffsetMinutes=300`,
      )
      .set(admin());
    expect(res.status).toBe(200);
    const periods = res.body.currencies[0].periods as Array<{
      period: string;
      receivedMinor: number;
    }>;
    expect(periods.find((p) => p.period === "2020-03-05")!.receivedMinor).toBe(600_000);
    expect(periods.find((p) => p.period === "2020-03-06")!.receivedMinor).toBe(1_200_000);
  });

  it("groups by month when asked", async () => {
    const res = await http()
      .get(`/v1/admin/payment-reports?from=2020-01-01T00:00:00.000Z&to=2020-07-01T00:00:00.000Z`)
      .set(admin());
    expect(res.body.groupBy).toBe("month"); // longer than ~2 months
    const periods = res.body.currencies[0].periods as Array<{
      period: string;
      receivedMinor: number;
    }>;
    expect(periods.map((p) => p.period)).toEqual([
      "2020-01-01",
      "2020-02-01",
      "2020-03-01",
      "2020-04-01",
      "2020-05-01",
      "2020-06-01",
    ]);
    expect(periods.find((p) => p.period === "2020-03-01")!.receivedMinor).toBe(1_800_000);
    expect(periods.find((p) => p.period === "2020-04-01")!.receivedMinor).toBe(999_900);
  });

  it("refuses a backwards range, an over-long range, and anyone but an admin", async () => {
    expect(
      (await http().get(`/v1/admin/payment-reports?from=${TO}&to=${FROM}`).set(admin())).status,
    ).toBe(400);
    expect(
      (
        await http()
          .get(
            `/v1/admin/payment-reports?from=2010-01-01T00:00:00.000Z&to=2020-01-01T00:00:00.000Z`,
          )
          .set(admin())
      ).status,
    ).toBe(400);
    expect((await http().get(`/v1/admin/payment-reports?${range}`).set(owner())).status).toBe(403);
    expect(
      (await http().get(`/v1/admin/payment-reports/export?${range}&format=csv`).set(owner()))
        .status,
    ).toBe(403);
  });

  it("exports a CSV: one row per payment, UTF-8 BOM, formula-looking text neutralised, audited", async () => {
    const res = await http()
      .get(`/v1/admin/payment-reports/export?${range}&format=csv`)
      .set(admin());
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="payments_2020-03-01_to_2020-03-31.csv"',
    );
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe(
      "Date,Business,Plan,Amount,Currency,Status,Reference,Months granted,Submitted,Reviewed,Rejection reason",
    );
    expect(lines).toHaveLength(5); // header + 2 received + 1 rejected + 1 waiting (April's is out of range)
    expect(lines.some((l) => l.includes(",6000,PKR,Received,R-1,1,"))).toBe(true);
    expect(
      lines.some((l) => l.includes(",Not accepted,R-3,,") && l.endsWith("Amount does not match")),
    ).toBe(true);
    expect(lines.some((l) => l.includes(",Waiting,R-5,"))).toBe(true);
    // The formula-looking reference is quoted text, not a live formula.
    expect(text).toContain("'=cmd");
    expect(text).not.toMatch(/,=cmd/);

    const audit = await fx.prisma.auditLog.findFirst({
      where: {
        resourceType: "payment_report",
        action: "PAYMENT_REPORT_EXPORTED",
        actorId: { in: extraUserIds },
      },
    });
    expect(audit).not.toBeNull();
  });

  it("exports an Excel file (a zip with a Summary and a Payments sheet)", async () => {
    const res = await http()
      .get(`/v1/admin/payment-reports/export?${range}&format=xlsx`)
      .set(admin())
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers["content-disposition"]).toContain("payments_2020-03-01_to_2020-03-31.xlsx");
    const bytes = res.body as Buffer;
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    const asText = bytes.toString("latin1");
    expect(asText).toContain("xl/worksheets/sheet1.xml");
    expect(asText).toContain("xl/worksheets/sheet2.xml");
    expect(asText).toContain('name="Summary"');
    expect(asText).toContain('name="Payments"');
  });
});
