import { PrinterStatus } from "@prisma/client";
import request from "supertest";
import { AgentJobsService } from "../src/agents/agent-jobs.service.js";
import {
  createInventoryFixture,
  type InventoryFixture as Fx,
} from "./helpers/inventory-fixture.js";

/** 25.2: the new PRD's concurrency requirements (§100) under real concurrency (Promise.all
 * against one API process, real Postgres row locks), repeated so an ordering-dependent bug has
 * several chances to show:
 *  - two people changing the same job, or the same order, at once;
 *  - invalid state transitions refused (every loser gets a clean 409, never a 500);
 *  - allocation never gives one job to two printers, even while the fleet changes;
 * Concurrent inventory updates are covered where the stock code lives (inventory-stock:
 * 12 consumptions against 5 in stock; inventory-consumption: 6 completions against 12 sheets;
 * inventory-api over HTTP), so they are not repeated here. */

const ROUNDS = 5;

describe("§100 concurrency (25.2, e2e)", () => {
  let fx: Fx;

  beforeAll(async () => {
    fx = await createInventoryFixture("cc100", {
      multiItemEnabled: true,
      autoFailoverEnabled: true,
      documentPages: 5,
    });
  });
  afterAll(async () => {
    await fx?.cleanup();
  });

  const http = () => request(fx.app.getHttpServer());
  const owner = () => ({ Authorization: `Bearer ${fx.token}` });
  const manager = () => ({ Authorization: `Bearer ${fx.manager.token}` });

  async function onlyNewPrinters(): Promise<void> {
    await fx.prisma.printer.updateMany({
      where: { shopId: fx.shop.id },
      data: { status: PrinterStatus.DISABLED },
    });
  }

  function liveJobs(orderId: string) {
    return fx.prisma.printJob.findMany({ where: { orderId, supersededAt: null } });
  }

  /** Every answer is a success or a clean refusal: never a 500. */
  function cleanOutcome(status: number): void {
    expect([200, 201, 409]).toContain(status);
  }

  async function acceptedJob(printerCount = 2) {
    await onlyNewPrinters();
    const printers = [];
    for (let i = 0; i < printerCount; i += 1) {
      printers.push(await fx.makePrinter(`cc100 P${i}`));
    }
    const { orderId } = await fx.makeOrder(1);
    await http().post(`/v1/shop/orders/${orderId}/accept`).set(owner()).expect(200);
    const [job] = await liveJobs(orderId);
    return { orderId, job: job!, printers };
  }

  it("two people act on one job at once (pause vs send to another printer): one consistent outcome, one live job", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { orderId, job, printers } = await acceptedJob();
      const [other] = printers.filter((p) => p.printer.id !== job.printerId);

      const pause = () => http().post(`/v1/print-jobs/${job.id}/pause`).set(owner()).send({});
      const move = () =>
        http()
          .post(`/v1/print-jobs/${job.id}/reassign`)
          .set(manager())
          .send({ printerId: other!.printer.id, reason: "race test" });
      // Alternate which request leaves first, so both orders of arrival are exercised.
      const [paused, moved] =
        round % 2 === 0
          ? await Promise.all([pause(), move()])
          : await Promise.all([move(), pause()]).then(([m, p]) => [p, m] as const);
      cleanOutcome(paused.status);
      cleanOutcome(moved.status);
      expect([paused.status, moved.status]).toContain(200);

      const live = await liveJobs(orderId);
      expect(live).toHaveLength(1);
      if (moved.status === 200) {
        // The move won (whatever the pause did): the one live job is on the other printer.
        expect(live[0]!.printerId).toBe(other!.printer.id);
      } else {
        // The move lost: the original job is still the live one, and paused.
        expect(live[0]!.id).toBe(job.id);
        expect(live[0]!.status).toBe("PAUSED");
      }
    }
  });

  it("two people accept one order at once: one print job, the other request refused cleanly", async () => {
    await onlyNewPrinters();
    await fx.makePrinter("cc100 accept");
    for (let round = 0; round < ROUNDS; round += 1) {
      const { orderId } = await fx.makeOrder(1);
      const answers = await Promise.all([
        http().post(`/v1/shop/orders/${orderId}/accept`).set(owner()),
        http().post(`/v1/shop/orders/${orderId}/accept`).set(manager()),
      ]);
      answers.forEach((answer) => cleanOutcome(answer.status));
      expect(answers.filter((answer) => answer.status === 200).length).toBeGreaterThanOrEqual(1);
      const jobs = await fx.prisma.printJob.findMany({ where: { orderId } });
      expect(jobs).toHaveLength(1);
    }
  });

  it("two people reprint one printed job at once: exactly one reprint", async () => {
    const agent = fx.app.get(AgentJobsService);
    for (let round = 0; round < ROUNDS; round += 1) {
      const { orderId, job, printers } = await acceptedJob(1);
      const deviceId = printers[0]!.deviceId;
      await agent.claim(job.id, deviceId);
      await agent.reportStatus(job.id, deviceId, { status: "PRINTING" });
      await agent.reportStatus(job.id, deviceId, { status: "PRINTED" });

      const answers = await Promise.all([
        http()
          .post(`/v1/print-jobs/${job.id}/reprint`)
          .set(owner())
          .set("Idempotency-Key", `cc100-${round}-owner`)
          .send({ reason: "POOR_QUALITY" }),
        http()
          .post(`/v1/print-jobs/${job.id}/reprint`)
          .set(manager())
          .set("Idempotency-Key", `cc100-${round}-manager`)
          .send({ reason: "PAPER_JAM" }),
      ]);
      answers.forEach((answer) => cleanOutcome(answer.status));
      expect(answers.filter((answer) => answer.status < 300)).toHaveLength(1);
      expect(await fx.prisma.printJobReprint.count({ where: { originalJobId: job.id } })).toBe(1);
      expect(await liveJobs(orderId)).toHaveLength(2); // the printed job and its one reprint
    }
  });

  it("allocation under load: 12 orders accepted while a printer is taken out of service -> one live job each, none stranded on it, each claimable by exactly one agent", async () => {
    const agent = fx.app.get(AgentJobsService);
    for (let round = 0; round < 2; round += 1) {
      await onlyNewPrinters();
      const fleet = [
        await fx.makePrinter(`cc100 load A${round}`),
        await fx.makePrinter(`cc100 load B${round}`),
        await fx.makePrinter(`cc100 load C${round}`),
      ];
      const leaving = fleet[0]!;
      const orders = [];
      for (let i = 0; i < 12; i += 1) orders.push(await fx.makeOrder(1));

      const answers = await Promise.all([
        ...orders.map((o) => http().post(`/v1/shop/orders/${o.orderId}/accept`).set(owner())),
        http()
          .patch(`/v1/shop/printers/${leaving.printer.id}`)
          .set(manager())
          .send({ enabled: false }),
      ]);
      answers.forEach((answer) => expect(answer.status).toBe(200));

      const live = [];
      for (const o of orders) {
        const jobs = await liveJobs(o.orderId);
        expect(jobs).toHaveLength(1);
        live.push(jobs[0]!);
      }
      // Nothing may be left waiting for a printer that is out of service.
      for (const job of live) {
        expect(job.status === "QUEUED" && job.printerId === leaving.printer.id).toBe(false);
      }

      // Every job is offered to one printer's agent: racing all three agents, exactly one
      // claim succeeds per job.
      for (const job of live.filter((j) => j.status === "QUEUED")) {
        const claims = await Promise.allSettled(fleet.map((p) => agent.claim(job.id, p.deviceId)));
        expect(claims.filter((c) => c.status === "fulfilled")).toHaveLength(1);
        const claimed = await fx.prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(claimed.status).toBe("CLAIMED");
      }
    }
  });
});
