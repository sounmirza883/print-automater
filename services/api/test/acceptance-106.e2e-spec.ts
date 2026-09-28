import { DocumentStatus, OrderStatus, PrinterStatus } from "@prisma/client";
import { periodStart } from "@print-automated/backend-shared";
import request from "supertest";
import { AgentTokenService } from "../src/agents/agent-token.service.js";
import {
  clearOfUtcMidnight,
  createPhase19Fixture,
  type Phase19Fixture as Fx,
} from "./helpers/phase19-fixture.js";

/** 25.1: the new PRD's eight acceptance scenarios (§106), each driven through the public HTTP
 * API a person or agent uses, against real Postgres, Redis and MinIO. Business A runs
 * scenarios 1-6 and 8 (one printer set per scenario: earlier printers are switched off first
 * so each scenario sees only its own); Business B exists for scenario 7. */

const A4_BW = {
  pages: { mode: "all" },
  copies: 1,
  paperSize: "A4",
  color: "BW",
  sides: "SINGLE",
  orientation: "PORTRAIT",
};

describe("§106 acceptance scenarios (25.1, e2e)", () => {
  let a: Fx;
  let b: Fx;

  beforeAll(async () => {
    await clearOfUtcMidnight();
    a = await createPhase19Fixture("acc106-a", {
      multiItemEnabled: true,
      autoFailoverEnabled: true,
      documentPages: 5,
    });
    b = await createPhase19Fixture("acc106-b", { multiItemEnabled: true, documentPages: 5 });
    // Provisioning: what the business offers customers, as the seed sets it (no API creates
    // a business or edits these; quoting checks them).
    await a.prisma.shop.update({
      where: { id: a.shop.id },
      data: { capabilities: { color: true, duplex: true, a4: true, a3: false } },
    });
  });

  afterAll(async () => {
    await Promise.allSettled([a?.cleanup(), b?.cleanup()]);
  });

  const http = (fx: Fx) => request(fx.app.getHttpServer());
  const staff = (fx: Fx) => ({ Authorization: `Bearer ${fx.token}` });

  /** Each scenario gets only its own printers. */
  async function onlyNewPrinters(fx: Fx): Promise<void> {
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id },
      data: { status: PrinterStatus.DISABLED },
    });
  }

  async function accept(fx: Fx, orderId: string): Promise<void> {
    await http(fx).post(`/v1/shop/orders/${orderId}/accept`).set(staff(fx)).expect(200);
  }

  async function liveJob(fx: Fx, orderId: string) {
    const jobs = await fx.prisma.printJob.findMany({ where: { orderId, supersededAt: null } });
    expect(jobs).toHaveLength(1);
    return jobs[0]!;
  }

  // ---- Scenario 1 (and the order scenario 8 reuses) -------------------------------------

  let confirmedOrder: { id: string; snapshot: unknown; documentId: string; customerId: string };

  it("Scenario 1: create a customer, create an order, upload a PDF, A4 black and white, confirm -> the order is in the production queue", async () => {
    await onlyNewPrinters(a);
    const printer = await a.makePrinter("S1 mono A4");

    // The business's prices (the owner sets them through the API).
    await http(a)
      .post("/v1/shop/pricing-rules")
      .set(staff(a))
      .send({
        shopId: a.shop.id,
        currency: "PKR",
        pricePerPageMinor: 1000,
        colorSurchargePerPageMinor: 500,
        otherCharges: [],
        minimumChargeMinor: 1000,
      })
      .expect(201);

    // Create a customer.
    const customer = await http(a)
      .post("/v1/shop/customers")
      .set(staff(a))
      .send({ shopId: a.shop.id, name: "Acceptance Walk-in", phone: "+923000000106" })
      .expect(201);

    // Upload a PDF (the real presigned-URL flow into MinIO).
    const pdf = Buffer.from("%PDF-1.7\nacceptance scenario 1\n%%EOF");
    const created = await http(a)
      .post("/v1/documents")
      .set(staff(a))
      .send({ filename: "scenario-1.pdf", mimeType: "application/pdf", sizeBytes: pdf.length })
      .expect(201);
    const documentId: string = created.body.documentId;
    a.trackDocument(documentId);
    const put = await fetch(created.body.uploadUrl, {
      method: "PUT",
      body: pdf,
      headers: { "Content-Type": "application/pdf" },
    });
    expect(put.ok).toBe(true);
    await http(a).post(`/v1/documents/${documentId}/upload`).set(staff(a)).expect(200);
    // The worker's scan/count pipeline is not part of this API process (the same shortcut
    // counter-orders.e2e takes): the document becomes READY with its page count.
    await a.prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.READY, pageCount: 3 },
    });

    // Create the order: A4, black and white.
    const order = await http(a)
      .post("/v1/shop/orders")
      .set(staff(a))
      .send({
        shopId: a.shop.id,
        documentId,
        customerRecordId: customer.body.id,
        printConfiguration: A4_BW,
      })
      .expect(201);
    // 3 pages at 1000 (the platform fee comes on top of the shop's price).
    expect(order.body.pricingSnapshot.quote.subtotalMinor).toBe(3000);

    // Confirm it: paid at the counter, then accepted for printing.
    const paid = await http(a)
      .post(`/v1/shop/orders/${order.body.id}/record-payment`)
      .set(staff(a))
      .expect(200);
    expect(paid.body.orderStatus).toBe("WAITING_FOR_SHOP");
    await accept(a, order.body.id);

    // Expected: the order appears in the production queue.
    const job = await liveJob(a, order.body.id);
    expect(job.status).toBe("QUEUED");
    expect(job.printerId).toBe(printer.printer.id);
    const production = await http(a)
      .get(`/v1/shop/dashboard/operator?shopId=${a.shop.id}`)
      .set(staff(a))
      .expect(200);
    const queued = [...production.body.waiting.items, ...production.body.myAssigned.items];
    expect(queued.map((j: { orderId: string }) => j.orderId)).toContain(order.body.id);
    const grouped = await http(a)
      .get(`/v1/shop/orders?shopId=${a.shop.id}`)
      .set(staff(a))
      .expect(200);
    expect(grouped.body.printing.map((o: { id: string }) => o.id)).toContain(order.body.id);

    confirmedOrder = {
      id: order.body.id,
      snapshot: order.body.pricingSnapshot,
      documentId,
      customerId: customer.body.id,
    };
  });

  // ---- Scenario 2 ------------------------------------------------------------------------

  it("Scenario 2: two printers can do the job and one is busy -> the eligible one is chosen by the rule", async () => {
    await onlyNewPrinters(a);
    const busy = await a.makePrinter("S2 busy", { status: PrinterStatus.BUSY });
    const free = await a.makePrinter("S2 free");

    // A printer that reports BUSY is not eligible for automatic allocation.
    const first = await a.makeOrder(1);
    await accept(a, first.orderId);
    expect((await liveJob(a, first.orderId)).printerId).toBe(free.printer.id);

    // Both available: the rule prefers the printer with the least queued work, so the
    // idle one (no longer busy) takes the next job rather than piling onto the free one.
    await a.prisma.printer.update({
      where: { id: busy.printer.id },
      data: { status: PrinterStatus.ONLINE },
    });
    const second = await a.makeOrder(1);
    await accept(a, second.orderId);
    expect((await liveJob(a, second.orderId)).printerId).toBe(busy.printer.id);
  });

  // ---- Scenarios 3 and 4 -----------------------------------------------------------------

  async function atLimit(fx: Fx, printerId: string, pages: number): Promise<void> {
    await fx.prisma.printerPageUsage.create({
      data: { printerId, periodStart: periodStart("DAILY", new Date()), pagesUsed: pages },
    });
  }

  it("Scenario 3: a printer at its page limit with enforcement on is left out of automatic allocation", async () => {
    await onlyNewPrinters(a);
    // Registered first, so it would win a tie on everything else.
    const limited = await a.makePrinter("S3 limited", { pageLimit: 10, pageLimitEnabled: true });
    const other = await a.makePrinter("S3 other");
    await atLimit(a, limited.printer.id, 10);

    const { orderId } = await a.makeOrder(1);
    await accept(a, orderId);
    expect((await liveJob(a, orderId)).printerId).toBe(other.printer.id);

    const detail = await http(a)
      .get(`/v1/shop/printers/${limited.printer.id}`)
      .set(staff(a))
      .expect(200);
    expect(detail.body.remainingAllowance).toBe(0);
  });

  it("Scenario 4: with page-limit enforcement off, the limit does not block automatic allocation", async () => {
    await onlyNewPrinters(a);
    const printer = await a.makePrinter("S4", { pageLimit: 10, pageLimitEnabled: false });
    await atLimit(a, printer.printer.id, 10);

    const { orderId } = await a.makeOrder(1);
    await accept(a, orderId);
    const job = await liveJob(a, orderId);
    expect(job.printerId).toBe(printer.printer.id);
    expect(job.status).toBe("QUEUED");
    expect(job.blockedReason).toBeNull();
  });

  // ---- Scenario 5 ------------------------------------------------------------------------

  it("Scenario 5: a printer becomes unavailable -> its waiting jobs move to another suitable printer", async () => {
    await onlyNewPrinters(a);
    const first = await a.makePrinter("S5 first");
    const second = await a.makePrinter("S5 second");
    const { orderId } = await a.makeOrder(1);
    await accept(a, orderId);
    expect((await liveJob(a, orderId)).printerId).toBe(first.printer.id);

    // Staff take the first printer out of service.
    await http(a)
      .patch(`/v1/shop/printers/${first.printer.id}`)
      .set(staff(a))
      .send({ enabled: false })
      .expect(200);

    const moved = await liveJob(a, orderId);
    expect(moved.printerId).toBe(second.printer.id);
    expect(moved.status).toBe("QUEUED");

    // And the second printer's agent is offered it.
    const agentToken = a.app.get(AgentTokenService).issue(second.deviceId, a.shop.id);
    const offered = await http(a)
      .get("/v1/agents/jobs?wait=1")
      .set("Authorization", `Bearer ${agentToken}`)
      .expect(200);
    expect(offered.body.id).toBe(moved.id);
  });

  // ---- Scenario 6 ------------------------------------------------------------------------

  it("Scenario 6: no compatible printer -> the job stays visible as blocked, with the reason", async () => {
    await onlyNewPrinters(a);
    await a.makePrinter("S6 mono only");
    const { orderId } = await a.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP, {
      ...A4_BW,
      color: "COLOR",
    });
    await accept(a, orderId);

    const job = await liveJob(a, orderId);
    expect(job.status).toBe("WAITING");
    expect(job.blockedReason).toBe("NO_COMPATIBLE_PRINTER");

    // Visible to staff: on the order and on the production view's blocked list.
    const order = await http(a).get(`/v1/shop/orders/${orderId}`).set(staff(a)).expect(200);
    expect(order.body.printJobs[0].blockedReason).toBe("NO_COMPATIBLE_PRINTER");
    const production = await http(a)
      .get(`/v1/shop/dashboard/operator?shopId=${a.shop.id}`)
      .set(staff(a))
      .expect(200);
    const blocked = production.body.blocked.items.find(
      (j: { orderId: string }) => j.orderId === orderId,
    );
    expect(blocked?.blockedReason).toBe("NO_COMPATIBLE_PRINTER");
  });

  // ---- Scenario 7 ------------------------------------------------------------------------

  it("Scenario 7: a Business A user or agent asking for a Business B file is denied", async () => {
    const printerB = await b.makePrinter("B printer");
    const { orderId } = await b.makeOrder(1);
    await accept(b, orderId);
    const jobB = await liveJob(b, orderId);
    expect(jobB.printerId).toBe(printerB.printer.id);

    // Business B's own staff can see it (so the denials below are about who is asking).
    await http(b).get(`/v1/shop/orders/${orderId}`).set(staff(b)).expect(200);

    // Business A's owner: the order, its invoice and its document are all refused.
    await http(a).get(`/v1/shop/orders/${orderId}`).set(staff(a)).expect(403);
    await http(a).get(`/v1/shop/orders/${orderId}/invoice`).set(staff(a)).expect(403);
    const document = await http(a).get(`/v1/documents/${b.document.id}/download`).set(staff(a));
    expect([403, 404]).toContain(document.status);
    expect(document.headers["content-type"] ?? "").not.toContain("application/pdf");

    // Business A's print agent cannot fetch Business B's job document.
    const agentA = await a.makePrinter("A agent for scenario 7", {
      status: PrinterStatus.DISABLED,
    });
    const agentToken = a.app.get(AgentTokenService).issue(agentA.deviceId, a.shop.id);
    const fetched = await http(a)
      .get(`/v1/agents/jobs/${jobB.id}/document`)
      .set("Authorization", `Bearer ${agentToken}`);
    expect(fetched.status).toBe(404);
  });

  // ---- Scenario 8 ------------------------------------------------------------------------

  it("Scenario 8: a price change after the order is confirmed does not change that order's price", async () => {
    // Scenario 1's order was confirmed at 1000 per page (3 pages: a 3000 subtotal).
    expect(confirmedOrder).toBeDefined();
    await http(a)
      .post("/v1/shop/pricing-rules")
      .set(staff(a))
      .send({
        shopId: a.shop.id,
        currency: "PKR",
        pricePerPageMinor: 5000,
        colorSurchargePerPageMinor: 500,
        otherCharges: [],
        minimumChargeMinor: 1000,
      })
      .expect(201);

    const after = await http(a)
      .get(`/v1/shop/orders/${confirmedOrder.id}`)
      .set(staff(a))
      .expect(200);
    expect(after.body.pricingSnapshot).toEqual(confirmedOrder.snapshot);
    expect(after.body.pricingSnapshot.quote.subtotalMinor).toBe(3000);

    // The new price is live: the same document ordered now costs 5000 per page.
    const newOrder = await http(a)
      .post("/v1/shop/orders")
      .set(staff(a))
      .send({
        shopId: a.shop.id,
        documentId: confirmedOrder.documentId,
        customerRecordId: confirmedOrder.customerId,
        printConfiguration: A4_BW,
      })
      .expect(201);
    expect(newOrder.body.pricingSnapshot.quote.subtotalMinor).toBe(15000);
  });
});
