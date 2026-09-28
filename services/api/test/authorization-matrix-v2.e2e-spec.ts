import { randomUUID } from "node:crypto";
import { DocumentStatus, OrderStatus, ShopStaffStatus, UserRole } from "@prisma/client";
import { ROLE_PERMISSIONS } from "@print-automated/backend-shared";
import { Permission } from "@print-automated/types";
import request from "supertest";
import {
  createInventoryFixture,
  type InventoryFixture as Fx,
} from "./helpers/inventory-fixture.js";

/** 25.4: authorization matrix v2 -- every shop role of the new PRD (including OPERATOR and
 * PRINTER_MANAGER) against every shop resource added since 12.1's matrix, plus the
 * cross-business, customer, platform-admin and anonymous rows.
 *
 * The permission each route needs is written here from the PRD (§47), NOT read from the
 * route decorators; which roles hold it comes from the server's own ROLE_PERMISSIONS. So a
 * route that lost its guard, or carries the wrong permission, shows up as a mismatch.
 *
 * "Allowed" means the request got past authorization: any status except 401/403, and never a
 * 5xx. Every mutating route's body is COMPLETE and valid (not merely `{shopId}`): a role
 * whose ACCOUNT-level role happens to hold the target permission (an owner or manager of a
 * different business) is not stopped by the guard layer at all -- `resolveEffectiveRole`
 * falls back to the account role when there is no membership at the target shop, by design,
 * and leaves real enforcement to the service's own `ShopMembershipService` check. An
 * incomplete body would be refused by validation (400) before that check ever runs, silently
 * passing a test that a missing membership check would fail too. So every write here reaches
 * the service for every identity, and a handful of rows this file creates (a customer, a
 * printer, a printer rule, a stock item, a supplier, a purchase order, a product, a price
 * list) are real and left for the shop's cascade delete to remove. */

type Identity = "owner" | "manager" | "counter" | "operator" | "printerManager";
const SHOP_ROLES: Record<Identity, UserRole> = {
  owner: UserRole.SHOP_OWNER,
  manager: UserRole.SHOP_MANAGER,
  counter: UserRole.SHOP_COUNTER,
  operator: UserRole.OPERATOR,
  printerManager: UserRole.PRINTER_MANAGER,
};

interface Route {
  permission: Permission;
  method: "get" | "post" | "put" | "patch";
  path: () => string;
  /** `identity` is the caller this request is FOR, when the body must reference something
   * scoped to that specific person (a document only its owner may cite) rather than the
   * shop; omitted for the outsider/anonymous checks, where it never matters because those
   * calls are refused before reaching such a check. */
  body?: (identity?: Identity) => Record<string, unknown>;
  headers?: Record<string, string>;
}

describe("Authorization matrix v2 (25.4, e2e)", () => {
  let fx: Fx;
  const tokens: Record<string, string> = {};
  const ids = {} as {
    printer: string;
    waitingOrder: string;
    completedOrder: string;
    printedJob: string;
    document: string;
    customerRecord: string;
    supplier: string;
    inventoryItem: string;
  };
  /** A ready document owned by each shop-role identity, so "create counter order" can cite
   * one its own document-ownership check will accept (see its body, below). */
  const documentIdByIdentity = {} as Record<Identity, string>;

  beforeAll(async () => {
    fx = await createInventoryFixture("authz2", { multiItemEnabled: true, documentPages: 5 });
    const { prisma } = fx;

    const printerManager = await prisma.user.create({
      data: {
        role: UserRole.PRINTER_MANAGER,
        name: "authz2 printer manager",
        email: `authz2-pm-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    fx.userIds.push(printerManager.id);
    await prisma.shopStaff.create({
      data: {
        shopId: fx.shop.id,
        userId: printerManager.id,
        role: UserRole.PRINTER_MANAGER,
        status: ShopStaffStatus.ACTIVE,
      },
    });
    const admin = await prisma.user.create({
      data: {
        role: UserRole.ADMIN,
        name: "authz2 admin",
        email: `authz2-admin-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
    fx.userIds.push(admin.id);

    tokens.owner = fx.token;
    tokens.manager = fx.manager.token;
    tokens.counter = fx.counter.token;
    tokens.operator = fx.operator.token;
    tokens.printerManager = fx.tokens.issueAccessToken(printerManager);
    tokens.ownerB = fx.ownerB.token;
    tokens.customer = fx.tokens.issueAccessToken(fx.customer);
    tokens.admin = fx.tokens.issueAccessToken(admin);

    ids.printer = (await fx.makePrinter("authz2 printer")).printer.id;
    ids.waitingOrder = (await fx.makeOrder(1)).orderId;
    ids.completedOrder = (await fx.makeOrder(1, 1, OrderStatus.COMPLETED)).orderId;
    const printed = await fx.makeOrder(1, 1, OrderStatus.PRINTED);
    ids.printedJob = (
      await prisma.printJob.create({
        data: {
          orderId: printed.orderId,
          shopId: fx.shop.id,
          orderItemId: printed.itemIds[0]!,
          printerId: ids.printer,
          status: "PRINTED",
          idempotencyToken: `${printed.itemIds[0]}:1`,
        },
      })
    ).id;

    // Prerequisites for write routes whose DTOs need a real reference: a counter order
    // needs a ready document (one per shop-role identity: a document is owned by whoever
    // uploaded it, so reusing one across identities would fail on THAT check, not the one
    // this matrix is testing) and a customer record; a purchase order needs a supplier and
    // one of its stock items. Created directly (not through the API under test) so they
    // exist regardless of which identity's request against THEM is what's under test.
    const userIdByIdentity: Record<Identity, string> = {
      owner: fx.owner.id,
      manager: fx.manager.user.id,
      counter: fx.counter.user.id,
      operator: fx.operator.user.id,
      printerManager: printerManager.id,
    };
    for (const [identity, ownerUserId] of Object.entries(userIdByIdentity) as Array<
      [Identity, string]
    >) {
      const doc = await prisma.document.create({
        data: {
          ownerUserId,
          storageKey: `test/authz2/${identity}/${randomUUID()}`,
          filename: `authz2-${identity}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 1,
          pageCount: 3,
          status: DocumentStatus.READY,
        },
      });
      fx.trackDocument(doc.id);
      documentIdByIdentity[identity] = doc.id;
    }
    ids.document = documentIdByIdentity.owner;
    const customerRecord = await prisma.customer.create({
      data: { shopId: fx.shop.id, name: "authz2 customer record" },
    });
    ids.customerRecord = customerRecord.id;
    const supplier = await prisma.supplier.create({
      data: { shopId: fx.shop.id, name: "authz2 supplier" },
    });
    ids.supplier = supplier.id;
    const inventoryItem = await prisma.inventoryItem.create({
      data: { shopId: fx.shop.id, name: "authz2 stock item" },
    });
    ids.inventoryItem = inventoryItem.id;
  });

  afterAll(async () => {
    await fx?.cleanup();
  });

  const shopQuery = () => `shopId=${fx.shop.id}`;
  const printConfig = () => ({
    pages: { mode: "all" },
    copies: 1,
    paperSize: "A4",
    color: "BW",
    sides: "SINGLE",
    orientation: "PORTRAIT",
  });

  const ROUTES: Record<string, Route> = {
    // Orders and customers.
    "list orders": {
      permission: Permission.VIEW_ORDERS,
      method: "get",
      path: () => `/v1/shop/orders?${shopQuery()}`,
    },
    "order detail": {
      permission: Permission.VIEW_ORDERS,
      method: "get",
      path: () => `/v1/shop/orders/${ids.waitingOrder}`,
    },
    "order history": {
      permission: Permission.VIEW_ORDERS,
      method: "get",
      path: () => `/v1/shop/orders/${ids.waitingOrder}/history`,
    },
    "list customers": {
      permission: Permission.VIEW_ORDERS,
      method: "get",
      path: () => `/v1/shop/customers?${shopQuery()}`,
    },
    "create customer": {
      permission: Permission.CREATE_ORDERS,
      method: "post",
      path: () => "/v1/shop/customers",
      body: () => ({ shopId: fx.shop.id, name: `authz2 walk-in ${randomUUID()}` }),
    },
    "create counter order": {
      permission: Permission.CREATE_ORDERS,
      method: "post",
      path: () => "/v1/shop/orders",
      body: (identity) => ({
        shopId: fx.shop.id,
        documentId: documentIdByIdentity[identity ?? "owner"],
        customerRecordId: ids.customerRecord,
        printConfiguration: printConfig(),
      }),
    },
    "accept order": {
      permission: Permission.EDIT_ORDERS,
      method: "post",
      path: () => `/v1/shop/orders/${ids.completedOrder}/accept`,
    },
    "reject order": {
      permission: Permission.EDIT_ORDERS,
      method: "post",
      path: () => `/v1/shop/orders/${ids.waitingOrder}/reject`,
      body: () => ({}),
    },
    "quality check": {
      permission: Permission.QUALITY_CHECK,
      method: "post",
      path: () => `/v1/shop/orders/${ids.waitingOrder}/quality-check`,
      body: () => ({}),
    },
    "set delivery": {
      permission: Permission.MANAGE_DELIVERY,
      method: "put",
      path: () => `/v1/shop/orders/${ids.waitingOrder}/delivery`,
      body: () => ({}),
    },
    // Print jobs.
    "pause job": {
      permission: Permission.PAUSE_JOBS,
      method: "post",
      path: () => `/v1/print-jobs/${ids.printedJob}/pause`,
      body: () => ({}),
    },
    "move job": {
      permission: Permission.ASSIGN_JOBS,
      method: "post",
      path: () => `/v1/print-jobs/${ids.printedJob}/reassign`,
      body: () => ({}),
    },
    "record job failure": {
      permission: Permission.RECORD_JOB_FAILURE,
      method: "post",
      path: () => `/v1/print-jobs/${ids.printedJob}/failure-reason`,
      body: () => ({}),
    },
    "reprint job": {
      permission: Permission.REPRINT_JOBS,
      method: "post",
      path: () => `/v1/print-jobs/${ids.printedJob}/reprint`,
      body: () => ({}),
      headers: { "Idempotency-Key": "authz2-reprint" },
    },
    // Dashboards and reports.
    "owner dashboard": {
      permission: Permission.VIEW_DASHBOARD,
      method: "get",
      path: () => `/v1/shop/dashboard/owner?${shopQuery()}`,
    },
    "production dashboard": {
      permission: Permission.VIEW_OPERATOR_DASHBOARD,
      method: "get",
      path: () => `/v1/shop/dashboard/operator?${shopQuery()}`,
    },
    "printer dashboard": {
      permission: Permission.VIEW_PRINTER_DASHBOARD,
      method: "get",
      path: () => `/v1/shop/dashboard/printers?${shopQuery()}`,
    },
    "revenue report": {
      permission: Permission.VIEW_REPORTS,
      method: "get",
      path: () => `/v1/shop/reports/revenue?${shopQuery()}`,
    },
    // Printers and automation.
    "list printers": {
      permission: Permission.VIEW_PRINTERS,
      method: "get",
      path: () => `/v1/shop/printers?${shopQuery()}`,
    },
    "printer detail": {
      permission: Permission.VIEW_PRINTERS,
      method: "get",
      path: () => `/v1/shop/printers/${ids.printer}`,
    },
    "register printer": {
      permission: Permission.MANAGE_PRINTERS,
      method: "post",
      path: () => "/v1/shop/printers",
      body: () => ({ shopId: fx.shop.id, name: `authz2 registered ${randomUUID()}` }),
    },
    "edit printer": {
      permission: Permission.MANAGE_PRINTERS,
      method: "patch",
      path: () => `/v1/shop/printers/${ids.printer}`,
      body: () => ({ name: "" }),
    },
    "pairing code": {
      permission: Permission.MANAGE_PRINTERS,
      method: "post",
      path: () => "/v1/shop/agents/pairing-code",
      body: () => ({ shopId: fx.shop.id }),
    },
    "list printer rules": {
      permission: Permission.VIEW_SETTINGS,
      method: "get",
      path: () => `/v1/shop/printer-rules?${shopQuery()}`,
    },
    "create printer rule": {
      permission: Permission.MANAGE_AUTOMATION,
      method: "post",
      path: () => "/v1/shop/printer-rules",
      body: () => ({
        shopId: fx.shop.id,
        name: `authz2 rule ${randomUUID()}`,
        action: "AVOID",
        printerIds: [ids.printer],
      }),
    },
    // Inventory, suppliers, purchasing.
    "list stock": {
      permission: Permission.VIEW_INVENTORY,
      method: "get",
      path: () => `/v1/shop/inventory/items?${shopQuery()}`,
    },
    "add stock item": {
      permission: Permission.MANAGE_INVENTORY,
      method: "post",
      path: () => "/v1/shop/inventory/items",
      body: () => ({ shopId: fx.shop.id, name: `authz2 stock ${randomUUID()}` }),
    },
    "list purchase orders": {
      permission: Permission.MANAGE_INVENTORY,
      method: "get",
      path: () => `/v1/shop/purchase-orders?${shopQuery()}`,
    },
    "create purchase order": {
      permission: Permission.MANAGE_INVENTORY,
      method: "post",
      path: () => "/v1/shop/purchase-orders",
      body: () => ({
        shopId: fx.shop.id,
        supplierId: ids.supplier,
        lines: [{ inventoryItemId: ids.inventoryItem, quantity: 1 }],
      }),
    },
    "list suppliers": {
      permission: Permission.MANAGE_SUPPLIERS,
      method: "get",
      path: () => `/v1/shop/suppliers?${shopQuery()}`,
    },
    "add supplier": {
      permission: Permission.MANAGE_SUPPLIERS,
      method: "post",
      path: () => "/v1/shop/suppliers",
      body: () => ({ shopId: fx.shop.id, name: `authz2 supplier ${randomUUID()}` }),
    },
    // Products and prices.
    "list products": {
      permission: Permission.MANAGE_PRICES,
      method: "get",
      path: () => `/v1/shop/products?${shopQuery()}`,
    },
    "add product": {
      permission: Permission.MANAGE_PRICES,
      method: "post",
      path: () => "/v1/shop/products",
      body: () => ({ shopId: fx.shop.id, name: `authz2 product ${randomUUID()}` }),
    },
    "list price lists": {
      permission: Permission.MANAGE_PRICES,
      method: "get",
      path: () => `/v1/shop/pricing-rules?${shopQuery()}`,
    },
    "new price list": {
      permission: Permission.MANAGE_PRICES,
      method: "post",
      path: () => "/v1/shop/pricing-rules",
      body: () => ({
        shopId: fx.shop.id,
        currency: "PKR",
        pricePerPageMinor: 1000,
        colorSurchargePerPageMinor: 500,
        minimumChargeMinor: 1000,
      }),
    },
    // Settings (reading, and a business-setting write that changes nothing).
    "read settings": {
      permission: Permission.VIEW_SETTINGS,
      method: "get",
      path: () => `/v1/shop/settings?${shopQuery()}`,
    },
    "change business settings": {
      permission: Permission.MANAGE_SETTINGS,
      method: "put",
      path: () => "/v1/shop/settings",
      body: () => ({ shopId: fx.shop.id, currency: "PKR" }),
    },
    // Staff.
    "staff directory": {
      permission: Permission.VIEW_STAFF_DIRECTORY,
      method: "get",
      path: () => `/v1/shop/staff/directory?${shopQuery()}`,
    },
    "list staff": {
      permission: Permission.MANAGE_USERS,
      method: "get",
      path: () => `/v1/shop/staff?${shopQuery()}`,
    },
    "list invitations": {
      permission: Permission.MANAGE_USERS,
      method: "get",
      path: () => `/v1/shop/staff/invites?${shopQuery()}`,
    },
    "invite staff": {
      permission: Permission.MANAGE_USERS,
      method: "post",
      path: () => "/v1/shop/staff",
      body: () => ({
        shopId: fx.shop.id,
        email: `authz2-invite-${randomUUID()}@print-automated.dev`,
        role: "SHOP_COUNTER",
      }),
    },
  };

  async function call(route: Route, token: string | null, identity?: Identity) {
    const req = request(fx.app.getHttpServer())[route.method](route.path());
    if (token !== null) req.set("Authorization", `Bearer ${token}`);
    for (const [name, value] of Object.entries(route.headers ?? {})) req.set(name, value);
    return route.body ? req.send(route.body(identity)) : req.send();
  }

  it.each(Object.keys(ROUTES))(
    "%s: each role gets exactly what the role table grants",
    async (name) => {
      const route = ROUTES[name]!;
      const mismatches: string[] = [];
      for (const [identity, role] of Object.entries(SHOP_ROLES) as Array<[Identity, UserRole]>) {
        const allowed = (ROLE_PERMISSIONS[role] ?? []).includes(route.permission);
        const res = await call(route, tokens[identity]!, identity);
        const got =
          res.status === 403 || res.status === 401
            ? "denied"
            : res.status >= 500
              ? `error ${res.status}`
              : "allowed";
        const want = allowed ? "allowed" : "denied";
        if (got !== want) mismatches.push(`${role}: wanted ${want}, got ${res.status}`);
      }
      for (const outsider of ["ownerB", "customer", "admin"]) {
        const res = await call(route, tokens[outsider]!);
        if (res.status !== 403) mismatches.push(`${outsider}: wanted 403, got ${res.status}`);
      }
      const anonymous = await call(route, null);
      if (anonymous.status !== 401)
        mismatches.push(`anonymous: wanted 401, got ${anonymous.status}`);
      expect(mismatches).toEqual([]);
    },
  );

  it("platform admin routes: ADMIN only; every shop role and a customer are refused", async () => {
    for (const path of [
      "/v1/admin/businesses",
      "/v1/admin/users",
      "/v1/admin/audit",
      "/v1/admin/system",
    ]) {
      const asAdmin = await request(fx.app.getHttpServer())
        .get(path)
        .set("Authorization", `Bearer ${tokens.admin}`);
      expect([path, asAdmin.status < 400]).toEqual([path, true]);
      for (const identity of [
        "owner",
        "manager",
        "counter",
        "operator",
        "printerManager",
        "customer",
      ]) {
        const res = await request(fx.app.getHttpServer())
          .get(path)
          .set("Authorization", `Bearer ${tokens[identity]}`);
        expect([identity, path, res.status]).toEqual([identity, path, 403]);
      }
    }
  });

  it("the matrix changed nothing it tested", async () => {
    const waiting = await fx.prisma.order.findUniqueOrThrow({ where: { id: ids.waitingOrder } });
    expect(waiting.orderStatus).toBe(OrderStatus.WAITING_FOR_SHOP);
    const completed = await fx.prisma.order.findUniqueOrThrow({
      where: { id: ids.completedOrder },
    });
    expect(completed.orderStatus).toBe(OrderStatus.COMPLETED);
    const job = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: ids.printedJob } });
    expect(job.status).toBe("PRINTED");
    expect(
      await fx.prisma.printJobReprint.count({ where: { originalJobId: ids.printedJob } }),
    ).toBe(0);
    const printer = await fx.prisma.printer.findUniqueOrThrow({ where: { id: ids.printer } });
    expect(printer.name).toBe("authz2 printer");
  });
});
