import request from "supertest";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";

/** 22.1 (PRD 75/76/81): one settings surface, tenant-guarded, audited,
 * optimistically versioned. */
describe("Shop settings API (22.1, e2e)", () => {
  let fx: InventoryFixture;
  const http = () => request(fx.app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token = fx.token, shopId = fx.shop.id) =>
    http().get("/v1/shop/settings").query({ shopId }).set(auth(token));
  const put = (body: Record<string, unknown>, token = fx.token) =>
    http()
      .put("/v1/shop/settings")
      .set(auth(token))
      .send({ shopId: fx.shop.id, ...body });
  const auditCount = () =>
    fx.prisma.auditLog.count({
      where: { action: "SHOP_SETTINGS_CHANGED", resourceId: fx.shop.id },
    });

  beforeAll(async () => {
    fx = await createInventoryFixture("shop-settings", { multiItemEnabled: false });
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  it("GET returns defaults that reproduce today's behaviour, plus the legacy flags", async () => {
    const res = await get().expect(200);
    expect(res.body).toMatchObject({
      shopId: fx.shop.id,
      version: 0,
      currency: "PKR",
      taxRateBasisPoints: null,
      operatingHours: null,
      notificationSettings: { emailEnabled: true, appEnabled: true },
      autoPrinterAssignmentEnabled: true,
      autoOperatorAssignmentEnabled: false,
      autoQueueManagementEnabled: true,
      inventoryAlertsEnabled: true,
      automaticNotificationsEnabled: true,
      pageLimitEnforcementEnabled: true,
      autoFailoverEnabled: false,
      inventoryTrackingEnabled: false,
      qualityCheckEnabled: false,
      multiItemEnabled: false,
    });
  });

  it("GET is readable by a manager, refused to operator and counter (VIEW_SETTINGS)", async () => {
    await get(fx.manager.token).expect(200);
    await get(fx.operator.token).expect(403);
    await get(fx.counter.token).expect(403);
  });

  it("tenant isolation: another shop's owner can neither read nor write this shop", async () => {
    await get(fx.ownerB.token).expect(403);
    await put({ currency: "USD" }, fx.ownerB.token).expect(403);
    const row = await fx.prisma.shopSettings.findUniqueOrThrow({ where: { shopId: fx.shop.id } });
    expect(row.currency).toBe("PKR");
  });

  it("owner updates business settings; version bumps; audit row carries before/after", async () => {
    const before = (await get().expect(200)).body;
    const res = await put({
      expectedVersion: before.version,
      currency: "USD",
      taxRateBasisPoints: 1700,
      operatingHours: {
        timezone: "Asia/Karachi",
        weekly: { mon: [{ open: "09:00", close: "17:00" }] },
      },
    }).expect(200);
    expect(res.body).toMatchObject({
      currency: "USD",
      taxRateBasisPoints: 1700,
      version: before.version + 1,
    });

    const audit = await fx.prisma.auditLog.findFirstOrThrow({
      where: { action: "SHOP_SETTINGS_CHANGED", resourceId: fx.shop.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.actorId).toBe(fx.owner.id);
    const meta = audit.metadata as {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      changedKeys: string[];
      fromVersion: number;
      toVersion: number;
    };
    expect(meta.before).toMatchObject({ currency: "PKR", taxRateBasisPoints: null });
    expect(meta.after).toMatchObject({ currency: "USD", taxRateBasisPoints: 1700 });
    expect([...meta.changedKeys].sort()).toEqual([
      "currency",
      "operatingHours",
      "taxRateBasisPoints",
    ]);
    expect(meta.fromVersion).toBe(before.version);
    expect(meta.toVersion).toBe(before.version + 1);
  });

  it("a no-op update writes nothing: no version bump, no audit row", async () => {
    const before = (await get().expect(200)).body;
    const audits = await auditCount();
    const res = await put({ currency: before.currency }).expect(200);
    expect(res.body.version).toBe(before.version);
    expect(await auditCount()).toBe(audits);
  });

  it("legacy flags are edited here but stay on shops (source of truth for the hot paths)", async () => {
    const on = {
      autoFailoverEnabled: true,
      qualityCheckEnabled: true,
      multiItemEnabled: true,
      inventoryTrackingEnabled: true,
    };
    const off = {
      autoFailoverEnabled: false,
      qualityCheckEnabled: false,
      multiItemEnabled: false,
      inventoryTrackingEnabled: false,
    };
    const res = await put(on).expect(200);
    expect(res.body).toMatchObject(on);
    expect(await fx.prisma.shop.findUniqueOrThrow({ where: { id: fx.shop.id } })).toMatchObject(on);
    await put(off).expect(200);
    expect(await fx.prisma.shop.findUniqueOrThrow({ where: { id: fx.shop.id } })).toMatchObject(
      off,
    );
  });

  it("stale expectedVersion is a 409 SETTINGS_VERSION_CONFLICT and changes nothing", async () => {
    const cur = (await get().expect(200)).body;
    const res = await put({ expectedVersion: cur.version - 1, currency: "EUR" }).expect(409);
    expect(res.body.error_code).toBe("SETTINGS_VERSION_CONFLICT");
    expect((await get().expect(200)).body.currency).toBe(cur.currency);
  });

  it("two admins racing on the same version: exactly one wins, the other gets 409, no clobber", async () => {
    const cur = (await get().expect(200)).body;
    const [c, d] = await Promise.all([
      put({ expectedVersion: cur.version, autoQueueManagementEnabled: false }),
      put({ expectedVersion: cur.version, autoQueueManagementEnabled: false }, fx.manager.token),
    ]);
    expect([c.status, d.status].sort()).toEqual([200, 409]);
    const after = (await get().expect(200)).body;
    expect(after.version).toBe(cur.version + 1);
    await put({ autoQueueManagementEnabled: true }).expect(200);
  });

  it("manager may change automation but not business settings (MANAGE_AUTOMATION vs MANAGE_SETTINGS)", async () => {
    await put({ autoPrinterAssignmentEnabled: false }, fx.manager.token).expect(200);
    await put({ autoPrinterAssignmentEnabled: true }, fx.manager.token).expect(200);
    await put({ currency: "EUR", autoPrinterAssignmentEnabled: true }, fx.manager.token).expect(
      403,
    );
    expect((await get().expect(200)).body.currency).not.toBe("EUR");
    await put({ autoPrinterAssignmentEnabled: false }, fx.operator.token).expect(403);
    await put({ autoPrinterAssignmentEnabled: false }, fx.counter.token).expect(403);
  });

  it("rejects invalid bodies with 400", async () => {
    await put({ currency: "usd" }).expect(400);
    await put({ taxRateBasisPoints: 99999 }).expect(400);
    await put({}).expect(400);
    await put({ nonsense: true }).expect(400);
  });

  it("existing PUT inventory/settings keeps working as an alias: same flag, version bumped, audited", async () => {
    const before = (await get().expect(200)).body;
    const res = await http()
      .put("/v1/shop/inventory/settings")
      .set(auth(fx.token))
      .send({ shopId: fx.shop.id, trackingEnabled: true })
      .expect(200);
    expect(res.body).toEqual({ shopId: fx.shop.id, trackingEnabled: true });
    const after = (await get().expect(200)).body;
    expect(after.inventoryTrackingEnabled).toBe(true);
    expect(after.version).toBe(before.version + 1);
    expect(
      await fx.prisma.auditLog.count({
        where: { action: "INVENTORY_TRACKING_CHANGED", resourceId: fx.shop.id },
      }),
    ).toBeGreaterThan(0);
    // still manager-level (MANAGE_INVENTORY), unchanged
    await http()
      .put("/v1/shop/inventory/settings")
      .set(auth(fx.manager.token))
      .send({ shopId: fx.shop.id, trackingEnabled: false })
      .expect(200);
    expect((await get().expect(200)).body.inventoryTrackingEnabled).toBe(false);
  });

  it("every shop has a settings row from birth (trigger), so readers never see 'no row'", async () => {
    expect(
      await fx.prisma.shopSettings.count({ where: { shopId: { in: [fx.shop.id, fx.shopB.id] } } }),
    ).toBe(2);
  });
});
