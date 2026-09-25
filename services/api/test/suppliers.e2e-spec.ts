import request from "supertest";
import { createInventoryFixture, type InventoryFixture } from "./helpers/inventory-fixture.js";

/** 20.6 (PRD 29/30): suppliers and the many-to-many supplier-product links. */
describe("Suppliers and supplier products (20.6, e2e)", () => {
  let fx: InventoryFixture;
  const http = () => request(fx.app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    fx = await createInventoryFixture("suppliers");
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  const createSupplier = (
    body: Record<string, unknown> = {},
    token = fx.token,
    shopId = fx.shop.id,
  ) =>
    http()
      .post("/v1/shop/suppliers")
      .set(as(token))
      .send({ shopId, name: "Paper Co", ...body });
  const makeItem = (shopId = fx.shop.id, name = "A4 80gsm") =>
    fx.prisma.inventoryItem.create({ data: { shopId, name, paperSize: "A4" } });

  describe("suppliers", () => {
    it("creates a supplier with the PRD 29 fields and defaults to ACTIVE", async () => {
      const res = await createSupplier({
        name: "Ream Wholesale",
        contactName: "Sana",
        email: "sales@ream.example",
        phone: "+92 300 1234567",
        address: "Industrial Area",
        paymentTerms: "Net 30",
        notes: "Delivers Tuesdays",
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        shopId: fx.shop.id,
        name: "Ream Wholesale",
        contactName: "Sana",
        email: "sales@ream.example",
        paymentTerms: "Net 30",
        status: "ACTIVE",
        notes: "Delivers Tuesdays",
      });
      const audit = await fx.prisma.auditLog.findFirst({
        where: { resourceId: res.body.id, action: "SUPPLIER_CREATED" },
      });
      expect(audit).not.toBeNull();
    });

    it("validates input (empty name, bad email)", async () => {
      expect((await createSupplier({ name: "" })).status).toBe(400);
      expect((await createSupplier({ email: "nope" })).status).toBe(400);
    });

    it("reads, patches (null clears a field) and retires a supplier via status; audited", async () => {
      const s = (await createSupplier({ name: "Patch Me", phone: "1" })).body;
      const got = await http().get(`/v1/shop/suppliers/${s.id}`).set(as(fx.token));
      expect(got.status).toBe(200);
      const patched = await http()
        .patch(`/v1/shop/suppliers/${s.id}`)
        .set(as(fx.token))
        .send({ name: "Patched", phone: null, status: "INACTIVE" });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ name: "Patched", phone: null, status: "INACTIVE" });
      expect(
        (await http().patch(`/v1/shop/suppliers/${s.id}`).set(as(fx.token)).send({})).status,
      ).toBe(400);
      expect(
        (
          await http()
            .patch(`/v1/shop/suppliers/${s.id}`)
            .set(as(fx.token))
            .send({ shopId: fx.shopB.id })
        ).status,
      ).toBe(400);
      expect(
        await fx.prisma.auditLog.count({ where: { resourceId: s.id, action: "SUPPLIER_UPDATED" } }),
      ).toBe(1);
    });

    it("lists paginated with search and status filters", async () => {
      for (let i = 0; i < 4; i += 1) await createSupplier({ name: `Listed ${i}` });
      const page = await http()
        .get("/v1/shop/suppliers")
        .query({ shopId: fx.shop.id, search: "Listed", limit: 3 })
        .set(as(fx.token));
      expect(page.status).toBe(200);
      expect(page.body).toMatchObject({ total: 4, limit: 3, offset: 0 });
      expect(page.body.items).toHaveLength(3);
      const rest = await http()
        .get("/v1/shop/suppliers")
        .query({ shopId: fx.shop.id, search: "Listed", limit: 3, offset: 3 })
        .set(as(fx.token));
      expect(rest.body.items).toHaveLength(1);
      expect(
        (
          await http()
            .get("/v1/shop/suppliers")
            .query({ shopId: fx.shop.id, limit: 101 })
            .set(as(fx.token))
        ).status,
      ).toBe(400);
      const inactive = await http()
        .get("/v1/shop/suppliers")
        .query({ shopId: fx.shop.id, status: "INACTIVE" })
        .set(as(fx.token));
      expect(inactive.body.items.every((x: { status: string }) => x.status === "INACTIVE")).toBe(
        true,
      );
    });
  });

  describe("supplier products (many-to-many with inventory items)", () => {
    it("links items to a supplier with the supplier's own sku, price and lead time", async () => {
      const s = (await createSupplier({ name: "Linker" })).body;
      const a = await makeItem(fx.shop.id, "Item A");
      const b = await makeItem(fx.shop.id, "Item B");
      const linkA = await http()
        .post(`/v1/shop/suppliers/${s.id}/products`)
        .set(as(fx.token))
        .send({
          inventoryItemId: a.id,
          supplierSku: "R-500",
          unitPriceMinor: 1200,
          leadTimeDays: 3,
        });
      expect(linkA.status).toBe(201);
      expect(linkA.body).toMatchObject({
        supplierId: s.id,
        inventoryItemId: a.id,
        itemName: "Item A",
        supplierSku: "R-500",
        unitPriceMinor: 1200,
        leadTimeDays: 3,
        active: true,
      });
      await http()
        .post(`/v1/shop/suppliers/${s.id}/products`)
        .set(as(fx.token))
        .send({ inventoryItemId: b.id })
        .expect(201);
      const list = await http().get(`/v1/shop/suppliers/${s.id}/products`).set(as(fx.token));
      expect(list.body.items.map((p: { itemName: string }) => p.itemName).sort()).toEqual([
        "Item A",
        "Item B",
      ]);
    });

    it("a product may have several suppliers, seen from the item side", async () => {
      const item = await makeItem(fx.shop.id, "Shared item");
      const s1 = (await createSupplier({ name: "S1" })).body;
      const s2 = (await createSupplier({ name: "S2" })).body;
      for (const s of [s1, s2]) {
        await http()
          .post(`/v1/shop/suppliers/${s.id}/products`)
          .set(as(fx.token))
          .send({ inventoryItemId: item.id, unitPriceMinor: s === s1 ? 10 : 9 })
          .expect(201);
      }
      const res = await http()
        .get(`/v1/shop/inventory/items/${item.id}/suppliers`)
        .set(as(fx.token));
      expect(res.status).toBe(200);
      expect(res.body.items.map((p: { supplierName: string }) => p.supplierName).sort()).toEqual([
        "S1",
        "S2",
      ]);
    });

    it("refuses a duplicate link (409) and updates/unlinks a link", async () => {
      const s = (await createSupplier({ name: "Dup" })).body;
      const item = await makeItem();
      const link = (
        await http()
          .post(`/v1/shop/suppliers/${s.id}/products`)
          .set(as(fx.token))
          .send({ inventoryItemId: item.id })
      ).body;
      const dup = await http()
        .post(`/v1/shop/suppliers/${s.id}/products`)
        .set(as(fx.token))
        .send({ inventoryItemId: item.id });
      expect(dup.status).toBe(409);
      expect(dup.body.error_code).toBe("SUPPLIER_PRODUCT_EXISTS");
      const upd = await http()
        .patch(`/v1/shop/supplier-products/${link.id}`)
        .set(as(fx.token))
        .send({ unitPriceMinor: 5, active: false });
      expect(upd.status).toBe(200);
      expect(upd.body).toMatchObject({ unitPriceMinor: 5, active: false });
      expect(
        (await http().delete(`/v1/shop/supplier-products/${link.id}`).set(as(fx.token))).status,
      ).toBe(204);
      expect(await fx.prisma.supplierProduct.count({ where: { id: link.id } })).toBe(0);
      // the item and supplier survive
      expect(await fx.prisma.inventoryItem.count({ where: { id: item.id } })).toBe(1);
    });

    it("cross-shop links are impossible: an item of another shop is 404 at the API and refused by the composite FK at the DB", async () => {
      const s = (await createSupplier({ name: "Cross" })).body;
      const foreignItem = await makeItem(fx.shopB.id, "Shop B item");
      const res = await http()
        .post(`/v1/shop/suppliers/${s.id}/products`)
        .set(as(fx.token))
        .send({ inventoryItemId: foreignItem.id });
      expect(res.status).toBe(404);
      await expect(
        fx.prisma.supplierProduct.create({
          data: { shopId: fx.shop.id, supplierId: s.id, inventoryItemId: foreignItem.id },
        }),
      ).rejects.toThrow(/Foreign key constraint/);
    });
  });

  describe("permissions and tenant isolation", () => {
    it("MANAGE_SUPPLIERS: manager and owner yes; operator and counter 403 on every route", async () => {
      const s = (await createSupplier({ name: "Perm" })).body;
      expect((await createSupplier({ name: "By manager" }, fx.manager.token)).status).toBe(201);
      for (const t of [fx.operator.token, fx.counter.token]) {
        expect((await createSupplier({}, t)).status).toBe(403);
        expect(
          (await http().get("/v1/shop/suppliers").query({ shopId: fx.shop.id }).set(as(t))).status,
        ).toBe(403);
        expect((await http().get(`/v1/shop/suppliers/${s.id}`).set(as(t))).status).toBe(403);
        expect(
          (await http().patch(`/v1/shop/suppliers/${s.id}`).set(as(t)).send({ name: "x" })).status,
        ).toBe(403);
      }
      expect((await http().get("/v1/shop/suppliers").query({ shopId: fx.shop.id })).status).toBe(
        401,
      );
    });

    it("another shop's owner gets 403 on every supplier and link route, and never sees the data in a list", async () => {
      const s = (await createSupplier({ name: "Only A" })).body;
      const item = await makeItem();
      const link = (
        await http()
          .post(`/v1/shop/suppliers/${s.id}/products`)
          .set(as(fx.token))
          .send({ inventoryItemId: item.id })
      ).body;
      const b = as(fx.ownerB.token);
      expect((await http().get(`/v1/shop/suppliers/${s.id}`).set(b)).status).toBe(403);
      expect(
        (await http().patch(`/v1/shop/suppliers/${s.id}`).set(b).send({ name: "hijack" })).status,
      ).toBe(403);
      expect((await http().get(`/v1/shop/suppliers/${s.id}/products`).set(b)).status).toBe(403);
      expect(
        (
          await http()
            .post(`/v1/shop/suppliers/${s.id}/products`)
            .set(b)
            .send({ inventoryItemId: item.id })
        ).status,
      ).toBe(403);
      expect(
        (await http().patch(`/v1/shop/supplier-products/${link.id}`).set(b).send({ active: false }))
          .status,
      ).toBe(403);
      expect((await http().delete(`/v1/shop/supplier-products/${link.id}`).set(b)).status).toBe(
        403,
      );
      expect(
        (await http().get(`/v1/shop/inventory/items/${item.id}/suppliers`).set(b)).status,
      ).toBe(403);
      expect(
        (await http().get("/v1/shop/suppliers").query({ shopId: fx.shop.id }).set(b)).status,
      ).toBe(403);
      expect((await createSupplier({}, fx.ownerB.token, fx.shop.id)).status).toBe(403);
      const listB = await http().get("/v1/shop/suppliers").query({ shopId: fx.shopB.id }).set(b);
      expect(listB.status).toBe(200);
      expect(listB.body.items.some((x: { name: string }) => x.name === "Only A")).toBe(false);
      expect((await fx.prisma.supplier.findUniqueOrThrow({ where: { id: s.id } })).name).toBe(
        "Only A",
      );
    });
  });
});
