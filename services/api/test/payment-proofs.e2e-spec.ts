import { randomUUID } from "node:crypto";
import { UserRole } from "@prisma/client";
import { StorageService } from "@print-automated/backend-shared";
import request from "supertest";
import { TokenService } from "../src/auth/token.service.js";
import { createPhase19Fixture, type Phase19Fixture as Fx } from "./helpers/phase19-fixture.js";

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("e2e-proof"),
]);
const PDF_BYTES = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("e2e-proof")]);

/** Manual plan billing: an owner submits proof of an off-app payment; a platform admin
 * approves (granting N calendar months) or rejects. */
describe("Payment proofs (manual plan billing, e2e)", () => {
  let fx: Fx;
  let adminToken: string;
  let planId: string;
  let originalInstructions: string;
  const extraUserIds: string[] = [];
  const createdKeys: string[] = [];

  beforeAll(async () => {
    fx = await createPhase19Fixture("payment-proofs", { multiItemEnabled: false });
    const admin = await fx.prisma.user.create({
      data: {
        role: UserRole.ADMIN,
        name: "Proofs E2E Admin",
        email: `proofs-e2e-admin-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    extraUserIds.push(admin.id);
    adminToken = fx.app.get(TokenService).issueAccessToken(admin);
    const plan = await fx.prisma.planDefinition.create({
      data: {
        name: `Proofs E2E plan ${randomUUID()}`,
        priceMinor: 600_000,
        currency: "PKR",
        billingPeriodDays: 30,
      },
    });
    planId = plan.id;
    const settings = await fx.prisma.platformSettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    originalInstructions = settings.paymentInstructions;
  });

  afterAll(async () => {
    // payment_proofs.plan_definition_id is ON DELETE RESTRICT: proofs go first.
    await fx.prisma.paymentProof.deleteMany({ where: { shopId: fx.shop.id } });
    await fx.prisma.shopPlan.updateMany({
      where: { planDefinitionId: planId },
      data: { planDefinitionId: null },
    });
    await fx.prisma.planDefinition.deleteMany({ where: { id: planId } });
    await fx.prisma.platformSettings.update({
      where: { id: 1 },
      data: { paymentInstructions: originalInstructions },
    });
    // The app itself never deletes proof files; this is the test cleaning up its own objects.
    const storage = fx.app.get(StorageService);
    await Promise.all(createdKeys.map((key) => storage.deleteObject(key).catch(() => undefined)));
    await fx.prisma.auditLog.deleteMany({ where: { actorId: { in: extraUserIds } } });
    await fx.prisma.user.deleteMany({ where: { id: { in: extraUserIds } } });
    await fx?.cleanup();
  });

  const http = () => request(fx.app.getHttpServer());
  const owner = () => ({ Authorization: `Bearer ${fx.token}` });
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });

  const submitBody = (overrides: Record<string, unknown> = {}) => ({
    shopId: fx.shop.id,
    planDefinitionId: planId,
    amountMinor: 600_000,
    transactionRef: `TX-${randomUUID()}`,
    fileName: "receipt.png",
    fileContentType: "image/png",
    fileBase64: PNG_BYTES.toString("base64"),
    ...overrides,
  });

  async function submit(overrides: Record<string, unknown> = {}) {
    const res = await http()
      .post("/v1/shop/payment-proofs")
      .set(owner())
      .send(submitBody(overrides));
    if (res.status === 201) {
      createdKeys.push(`payment-proofs/${res.body.id as string}`);
    }
    return res;
  }

  async function currentExpiry(): Promise<Date> {
    const row = await fx.prisma.shopPlan.findUniqueOrThrow({ where: { shopId: fx.shop.id } });
    return row.expiresAt!;
  }

  it("owner submits proof -> PENDING, file stored; a second submit while pending is 409", async () => {
    const res = await submit();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      shopId: fx.shop.id,
      planDefinitionId: planId,
      amountMinor: 600_000,
      currency: "PKR",
      status: "PENDING",
      fileContentType: "image/png",
      fileSize: PNG_BYTES.length,
      reviewedAt: null,
    });
    expect(await fx.app.get(StorageService).objectExists(`payment-proofs/${res.body.id}`)).toBe(
      true,
    );

    const second = await submit();
    expect(second.status).toBe(409);
    expect(second.body.error_code).toBe("PAYMENT_PROOF_PENDING_EXISTS");

    const audit = await fx.prisma.auditLog.findFirst({
      where: {
        resourceType: "payment_proof",
        resourceId: res.body.id,
        action: "PAYMENT_PROOF_SUBMITTED",
      },
    });
    expect(audit).not.toBeNull();

    // Clean the slate for the next tests.
    await http()
      .post(`/v1/admin/payment-proofs/${res.body.id}/reject`)
      .set(admin())
      .send({ reason: "test cleanup" });
  });

  it("owner sees only payable plans (no archived, no contact-only)", async () => {
    const hidden = await fx.prisma.planDefinition.create({
      data: {
        name: `Proofs E2E contact-only ${randomUUID()}`,
        priceMinor: 1,
        currency: "PKR",
        billingPeriodDays: 30,
        contactOnly: true,
      },
    });
    try {
      const res = await http().get("/v1/shop/payment-proofs/plans").set(owner());
      expect(res.status).toBe(200);
      const ids = res.body.items.map((p: { id: string }) => p.id);
      expect(ids).toContain(planId);
      expect(ids).not.toContain(hidden.id);
    } finally {
      await fx.prisma.planDefinition.delete({ where: { id: hidden.id } });
    }
  });

  it("accepts a realistic multi-MB screenshot (route-scoped body limit) without raising other routes' limit", async () => {
    const big = Buffer.concat([PNG_BYTES, Buffer.alloc(4 * 1024 * 1024, 7)]);
    const res = await submit({ fileBase64: big.toString("base64") });
    expect(res.status).toBe(201);
    expect(res.body.fileSize).toBe(big.length);
    await http()
      .post(`/v1/admin/payment-proofs/${res.body.id}/reject`)
      .set(admin())
      .send({ reason: "test cleanup" });

    // Every other route keeps Express's 100 kb default: a 200 kb body is refused, not
    // parsed (the exception filter currently reports body-parser's 413 as a 500).
    const oversized = await http()
      .post("/v1/auth/login")
      .send({ email: "x@example.com", password: "x".repeat(200_000) });
    expect(oversized.status).toBeGreaterThanOrEqual(413);
    expect(oversized.body.error_code).not.toBe("ZOD_VALIDATION");
  });

  it("refuses a file whose bytes do not match its declared type", async () => {
    const res = await submit({ fileContentType: "application/pdf" }); // PNG bytes, claims PDF
    expect(res.status).toBe(400);
    expect(res.body.error_code).toBe("PAYMENT_PROOF_INVALID_FILE");
  });

  it("refuses a non-owner of the shop, and a user from another shop", async () => {
    const other = await createPhase19Fixture("payment-proofs-other", { multiItemEnabled: false });
    try {
      const res = await http()
        .post("/v1/shop/payment-proofs")
        .set({ Authorization: `Bearer ${other.token}` })
        .send(submitBody());
      expect(res.status).toBe(403);

      const list = await http()
        .get(`/v1/shop/payment-proofs?shopId=${fx.shop.id}`)
        .set({ Authorization: `Bearer ${other.token}` });
      expect(list.status).toBe(403);
    } finally {
      await other.cleanup();
    }
  });

  it("only ADMIN may use the admin routes -- the owner gets 403", async () => {
    expect((await http().get("/v1/admin/payment-proofs").set(owner())).status).toBe(403);
    expect(
      (
        await http()
          .post(`/v1/admin/payment-proofs/${randomUUID()}/approve`)
          .set(owner())
          .send({ months: 1 })
      ).status,
    ).toBe(403);
  });

  it("admin approves with 12 months: expiry moves by calendar months, status flips once, audited", async () => {
    const created = await submit({
      fileName: "receipt.pdf",
      fileContentType: "application/pdf",
      fileBase64: PDF_BYTES.toString("base64"),
    });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // The admin sees it in the PENDING queue and can preview the exact file.
    const queue = await http().get("/v1/admin/payment-proofs?status=PENDING").set(admin());
    expect(queue.status).toBe(200);
    expect(queue.body.items.map((p: { id: string }) => p.id)).toContain(id);
    const file = await http().get(`/v1/admin/payment-proofs/${id}/file`).set(admin()).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toContain("application/pdf");
    expect(file.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.from(file.body as Buffer).equals(PDF_BYTES)).toBe(true);

    const before = await currentExpiry();
    const res = await http()
      .post(`/v1/admin/payment-proofs/${id}/approve`)
      .set(admin())
      .send({ months: 12 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id, status: "APPROVED", grantedMonths: 12 });

    const after = await currentExpiry();
    const expected = new Date(before.getTime());
    expected.setUTCFullYear(expected.getUTCFullYear() + 1);
    // 30-day grace expiry + 12 calendar months (same day-of-month a year on, ignoring DST-free UTC).
    expect(Math.abs(after.getTime() - expected.getTime())).toBeLessThan(2 * 86_400_000);

    const plan = await fx.prisma.shopPlan.findUniqueOrThrow({ where: { shopId: fx.shop.id } });
    expect(plan.planDefinitionId).toBe(planId);

    const again = await http()
      .post(`/v1/admin/payment-proofs/${id}/approve`)
      .set(admin())
      .send({ months: 12 });
    expect(again.status).toBe(409);
    expect(again.body.error_code).toBe("PAYMENT_PROOF_ALREADY_REVIEWED");
    expect((await currentExpiry()).getTime()).toBe(after.getTime()); // no double grant

    const audit = await fx.prisma.auditLog.findFirst({
      where: { resourceType: "payment_proof", resourceId: id, action: "PAYMENT_PROOF_APPROVED" },
    });
    expect(audit).not.toBeNull();
  });

  it("admin approves with a custom number of months", async () => {
    const created = await submit();
    const before = await currentExpiry();
    const res = await http()
      .post(`/v1/admin/payment-proofs/${created.body.id}/approve`)
      .set(admin())
      .send({ months: 3 });
    expect(res.status).toBe(201);
    const after = await currentExpiry();
    const days = (after.getTime() - before.getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(89);
    expect(days).toBeLessThanOrEqual(93);
  });

  it("reject requires a reason, keeps the file, and lets the owner submit again", async () => {
    const created = await submit();
    const id = created.body.id as string;

    const noReason = await http()
      .post(`/v1/admin/payment-proofs/${id}/reject`)
      .set(admin())
      .send({ reason: "  " });
    expect(noReason.status).toBe(400);

    const res = await http()
      .post(`/v1/admin/payment-proofs/${id}/reject`)
      .set(admin())
      .send({ reason: "Amount does not match" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: "REJECTED",
      rejectionReason: "Amount does not match",
    });

    // The rejected proof's file is still there and still viewable by its owner.
    expect(await fx.app.get(StorageService).objectExists(`payment-proofs/${id}`)).toBe(true);
    const ownFile = await http()
      .get(`/v1/shop/payment-proofs/${id}/file?shopId=${fx.shop.id}`)
      .set(owner())
      .buffer(true);
    expect(ownFile.status).toBe(200);
    expect(Buffer.from(ownFile.body as Buffer).equals(PNG_BYTES)).toBe(true);

    // Not a dead end: a fresh submission is accepted again.
    const resubmit = await submit();
    expect(resubmit.status).toBe(201);
    await http()
      .post(`/v1/admin/payment-proofs/${resubmit.body.id}/reject`)
      .set(admin())
      .send({ reason: "test cleanup" });

    const history = await http().get(`/v1/shop/payment-proofs?shopId=${fx.shop.id}`).set(owner());
    expect(history.status).toBe(200);
    expect(history.body.map((p: { id: string }) => p.id)).toContain(id);
  });

  it("flags a duplicate transaction reference for the reviewing admin (soft warning)", async () => {
    const ref = `DUP-${randomUUID()}`;
    const first = await submit({ transactionRef: ref });
    await http()
      .post(`/v1/admin/payment-proofs/${first.body.id}/reject`)
      .set(admin())
      .send({ reason: "test cleanup" });
    const second = await submit({ transactionRef: ref });
    expect(second.status).toBe(201);

    const detail = await http().get(`/v1/admin/payment-proofs/${second.body.id}`).set(admin());
    expect(detail.body.duplicateTransactionRef).toBe(true);
    await http()
      .post(`/v1/admin/payment-proofs/${second.body.id}/reject`)
      .set(admin())
      .send({ reason: "test cleanup" });
  });

  it("payment instructions: admin edits, every shop role reads", async () => {
    const put = await http()
      .put("/v1/admin/payment-instructions")
      .set(admin())
      .send({ paymentInstructions: "Bank: Example Bank, IBAN PK00 TEST 0000" });
    expect(put.status).toBe(200);

    const read = await http().get("/v1/shop/payment-instructions").set(owner());
    expect(read.status).toBe(200);
    expect(read.body.paymentInstructions).toBe("Bank: Example Bank, IBAN PK00 TEST 0000");

    const denied = await http()
      .put("/v1/admin/payment-instructions")
      .set(owner())
      .send({ paymentInstructions: "hijack" });
    expect(denied.status).toBe(403);
  });
});
