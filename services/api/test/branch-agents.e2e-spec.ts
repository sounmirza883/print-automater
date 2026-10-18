import "reflect-metadata";
import { generateKeyPairSync, randomUUID, sign as cryptoSign } from "node:crypto";
import { OrderStatus, PrinterStatus, PrintJobStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { createPhase19Fixture, type Phase19Fixture } from "./helpers/phase19-fixture.js";

/** Step 3 / B5: a paired PC and its printers belong to a branch. A pairing code is issued for one
 * branch; the agent registered with it, and every printer its heartbeat reports, land there;
 * same-named printers at two branches never merge; and an owner can move a PC (with all its
 * printers) to another branch, but only while none of them has a job queued or printing. The
 * agent protocol itself is unchanged: the branch is read from the agent's row. */
describe("Agents, pairing and moving a PC (step 3 / B5, e2e)", () => {
  let fx: Phase19Fixture;
  type Member = Awaited<ReturnType<Phase19Fixture["makeMember"]>>;
  let branchB: Awaited<ReturnType<Phase19Fixture["addBranch"]>>;
  let managerA: Member;
  let managerB: Member;
  let roaming: Member;
  let counterB: Member;
  let otherShopBranchId: string;
  let otherShopId: string;

  const http = () => request(fx.app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const owner = () => bearer(fx.token);

  interface PairedAgent {
    deviceId: string;
    accessToken: string;
    agentId: string;
  }

  /** The whole real path: staff issue a code, the agent registers with it, proves its key. */
  async function pair(
    branchId: string | undefined,
    issuer: { token: string } = { token: fx.token },
  ) {
    const issued = await http()
      .post("/v1/shop/agents/pairing-code")
      .set(bearer(issuer.token))
      .send({ shopId: fx.shop.id, ...(branchId ? { branchId } : {}) });
    expect(issued.status).toBe(201);
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const deviceId = randomUUID();
    const registered = await http()
      .post("/v1/agents/register")
      .send({
        pairingCode: issued.body.code,
        deviceId,
        publicKey: (publicKey.export({ format: "jwk" }) as { x: string }).x,
      });
    expect(registered.status).toBe(201);
    const challenge = await http().post("/v1/agents/authenticate/challenge").send({ deviceId });
    const signature = cryptoSign(
      null,
      Buffer.from(challenge.body.nonce as string),
      privateKey,
    ).toString("base64url");
    const auth = await http().post("/v1/agents/authenticate").send({ deviceId, signature });
    const agent = await fx.prisma.printerAgent.findUniqueOrThrow({ where: { deviceId } });
    return {
      issued: issued.body as { code: string; branchId: string; branchName: string },
      agent: {
        deviceId,
        accessToken: auth.body.accessToken as string,
        agentId: agent.id,
      } as PairedAgent,
    };
  }

  const heartbeat = (
    agent: PairedAgent,
    names: string[],
    status: PrinterStatus = PrinterStatus.ONLINE,
  ) =>
    http()
      .post("/v1/agents/heartbeat")
      .set(bearer(agent.accessToken))
      .send({
        printers: names.map((name) => ({
          name,
          status,
          capabilities: { color: false, duplex: false, a4: true, a3: false },
        })),
      });

  const printersNamed = (name: string) =>
    fx.prisma.printer.findMany({ where: { shopId: fx.shop.id, name } });

  const unique = (label: string) => `${label}-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    fx = await createPhase19Fixture("bagent", {
      multiItemEnabled: true,
      autoFailoverEnabled: true,
    });
    branchB = await fx.addBranch("B");
    managerA = await fx.makeMember(UserRole.SHOP_MANAGER, fx.branch.id);
    managerB = await fx.makeMember(UserRole.SHOP_MANAGER, branchB.id);
    roaming = await fx.makeMember(UserRole.SHOP_MANAGER, null);
    counterB = await fx.makeMember(UserRole.SHOP_COUNTER, branchB.id);
    const other = await fx.prisma.shop.create({
      data: { name: `bagent other ${randomUUID()}`, address: "9 Elsewhere" },
    });
    otherShopId = other.id;
    otherShopBranchId = (await fx.prisma.branch.findFirstOrThrow({ where: { shopId: other.id } }))
      .id;
  }, 60_000);

  afterAll(async () => {
    await fx.prisma.shop.deleteMany({ where: { id: otherShopId } });
    await fx.cleanup();
  });

  describe("pairing a PC for a branch", () => {
    it("pairs for branch B: the code, the agent and every printer it reports are at B, none at A", async () => {
      const { issued, agent } = await pair(branchB.id);
      expect(issued).toMatchObject({ branchId: branchB.id, branchName: branchB.name });
      const code = await fx.prisma.agentPairingCode.findFirstOrThrow({
        where: { shopId: fx.shop.id, consumedAt: { not: null }, branchId: branchB.id },
        orderBy: { createdAt: "desc" },
      });
      expect(code.branchId).toBe(branchB.id);

      const row = await fx.prisma.printerAgent.findUniqueOrThrow({ where: { id: agent.agentId } });
      expect(row.branchId).toBe(branchB.id);

      const name = unique("paired");
      expect((await heartbeat(agent, [name])).status).toBe(200);
      const printers = await printersNamed(name);
      expect(printers).toHaveLength(1);
      expect(printers[0]).toMatchObject({ branchId: branchB.id, agentId: agent.agentId });
    });

    it("decides the branch of a code like a staff invite", async () => {
      // Several branches and none named: asked to choose.
      const asked = await http()
        .post("/v1/shop/agents/pairing-code")
        .set(owner())
        .send({ shopId: fx.shop.id });
      expect(asked.status).toBe(400);
      expect(asked.body.error_code).toBe("BRANCH_REQUIRED");

      // A branch-bound manager: their own branch, whether or not they name it, never another.
      const own = await http()
        .post("/v1/shop/agents/pairing-code")
        .set(bearer(managerA.token))
        .send({ shopId: fx.shop.id });
      expect(own.status).toBe(201);
      expect(own.body.branchId).toBe(fx.branch.id);
      const named = await http()
        .post("/v1/shop/agents/pairing-code")
        .set(bearer(managerA.token))
        .send({ shopId: fx.shop.id, branchId: fx.branch.id });
      expect(named.body.branchId).toBe(fx.branch.id);
      const elsewhere = await http()
        .post("/v1/shop/agents/pairing-code")
        .set(bearer(managerA.token))
        .send({ shopId: fx.shop.id, branchId: branchB.id });
      expect(elsewhere.status).toBe(403);

      // An all-branches manager names one.
      const roamer = await http()
        .post("/v1/shop/agents/pairing-code")
        .set(bearer(roaming.token))
        .send({ shopId: fx.shop.id, branchId: branchB.id });
      expect(roamer.body.branchId).toBe(branchB.id);

      // Unknown, another business's, and archived branches are refused.
      for (const branchId of [randomUUID(), otherShopBranchId]) {
        const res = await http()
          .post("/v1/shop/agents/pairing-code")
          .set(owner())
          .send({ shopId: fx.shop.id, branchId });
        expect(res.status).toBe(400);
        expect(res.body.error_code).toBe("BRANCH_NOT_FOUND");
      }
      const spare = await fx.addBranch("Spare");
      await fx.prisma.branch.update({ where: { id: spare.id }, data: { archivedAt: new Date() } });
      const archived = await http()
        .post("/v1/shop/agents/pairing-code")
        .set(owner())
        .send({ shopId: fx.shop.id, branchId: spare.id });
      expect(archived.status).toBe(409);
      expect(archived.body.error_code).toBe("BRANCH_ARCHIVED");
    });

    it("a business with one branch needs no branch named", async () => {
      const single = await createPhase19Fixture("bagentone", { multiItemEnabled: false });
      try {
        const res = await request(single.app.getHttpServer())
          .post("/v1/shop/agents/pairing-code")
          .set(bearer(single.token))
          .send({ shopId: single.shop.id });
        expect(res.status).toBe(201);
        expect(res.body.branchId).toBe(single.branch.id);
      } finally {
        await single.cleanup();
      }
    });

    it("refuses to register an agent with a code whose branch was archived since, leaving the code unused", async () => {
      const spare = await fx.addBranch("Doomed");
      const issued = await http()
        .post("/v1/shop/agents/pairing-code")
        .set(owner())
        .send({ shopId: fx.shop.id, branchId: spare.id });
      expect(issued.status).toBe(201);
      await fx.prisma.branch.update({ where: { id: spare.id }, data: { archivedAt: new Date() } });
      const { publicKey } = generateKeyPairSync("ed25519");
      const res = await http()
        .post("/v1/agents/register")
        .send({
          pairingCode: issued.body.code,
          deviceId: randomUUID(),
          publicKey: (publicKey.export({ format: "jwk" }) as { x: string }).x,
        });
      expect(res.status).toBe(409);
      expect(res.body.error_code).toBe("BRANCH_ARCHIVED");
      expect(await fx.prisma.printerAgent.count({ where: { branchId: spare.id } })).toBe(0);
    });
  });

  describe("heartbeat: printers are matched by branch and name", () => {
    it("same-named printers at two branches stay two rows, however often they report", async () => {
      const name = unique("HP LaserJet");
      const a = (await pair(fx.branch.id)).agent;
      const b = (await pair(branchB.id)).agent;

      for (let round = 0; round < 3; round += 1) {
        expect((await heartbeat(a, [name])).status).toBe(200);
        expect((await heartbeat(b, [name])).status).toBe(200);
      }
      const rows = await printersNamed(name);
      expect(rows).toHaveLength(2);
      const atA = rows.find((p) => p.branchId === fx.branch.id)!;
      const atB = rows.find((p) => p.branchId === branchB.id)!;
      expect(atA.agentId).toBe(a.agentId);
      expect(atB.agentId).toBe(b.agentId);
    });

    it("does not take over a hand-registered printer of the same name at another branch", async () => {
      const name = unique("Shared Name");
      const manual = await http()
        .post("/v1/shop/printers")
        .set(owner())
        .send({ shopId: fx.shop.id, branchId: fx.branch.id, name });
      expect(manual.status).toBe(201);
      expect(manual.body).toMatchObject({ branchId: fx.branch.id, branchName: fx.branch.name });

      const b = (await pair(branchB.id)).agent;
      expect((await heartbeat(b, [name])).status).toBe(200);
      const rows = await printersNamed(name);
      expect(rows).toHaveLength(2);
      const original = rows.find((p) => p.id === manual.body.id)!;
      expect(original.agentId).toBeNull();
      expect(original.branchId).toBe(fx.branch.id);
      const fresh = rows.find((p) => p.id !== manual.body.id)!;
      expect(fresh).toMatchObject({ branchId: branchB.id, agentId: b.agentId });

      // A PC at the printer's own branch does link to it.
      const a = (await pair(fx.branch.id)).agent;
      expect((await heartbeat(a, [name])).status).toBe(200);
      const linked = await fx.prisma.printer.findUniqueOrThrow({ where: { id: manual.body.id } });
      expect(linked.agentId).toBe(a.agentId);
      expect(await printersNamed(name)).toHaveLength(2);
    });

    it("a heartbeat that arrives while its PC is being moved leaves nothing behind at the old branch", async () => {
      const { agent } = await pair(fx.branch.id);
      const names = [unique("race-1"), unique("race-2")];
      expect((await heartbeat(agent, names)).status).toBe(200);
      const fresh = unique("race-new");

      // The owner's move, frozen half way: it holds the PC's locks, has moved everything to B, and
      // only commits after the heartbeat has had time to arrive and start waiting on them.
      const holdingTheMove = fx.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM printer_agents WHERE id = ${agent.agentId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM printers WHERE agent_id = ${agent.agentId} ORDER BY id FOR UPDATE`;
          await tx.printerAgent.update({
            where: { id: agent.agentId },
            data: { branchId: branchB.id },
          });
          await tx.printer.updateMany({
            where: { agentId: agent.agentId },
            data: { branchId: branchB.id },
          });
          await new Promise((resolve) => setTimeout(resolve, 1500));
        },
        { timeout: 20_000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      const arriving = heartbeat(agent, [...names, fresh]);
      const [, response] = await Promise.all([holdingTheMove, arriving]);
      expect(response.status).toBe(200);

      // Whatever order they interleaved in, the PC and every printer it reported are at ONE branch:
      // no printer row was created at A for a PC that is now at B, and no printer is a duplicate.
      const agentRow = await fx.prisma.printerAgent.findUniqueOrThrow({
        where: { id: agent.agentId },
      });
      const rows = await fx.prisma.printer.findMany({ where: { agentId: agent.agentId } });
      expect(rows.map((p) => p.name).sort()).toEqual([...names, fresh].sort());
      expect(rows.every((p) => p.branchId === agentRow.branchId)).toBe(true);
      expect(agentRow.branchId).toBe(branchB.id);
    }, 30_000);

    it("a PC will not claim a job from another branch, even one wrongly queued on its printer", async () => {
      // Last line of defence: every path that queues a job already checks the branch, but if a job
      // of branch A ever sat on a printer of branch B, B's PC must still refuse to print it.
      const { agent } = await pair(branchB.id);
      const name = unique("claim-guard");
      expect((await heartbeat(agent, [name])).status).toBe(200);
      const printerAtB = (await printersNamed(name))[0]!;
      expect(printerAtB.branchId).toBe(branchB.id);

      const orderAtA = (
        await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT, undefined, fx.branch.id)
      ).orderId;
      const item = await fx.prisma.orderItem.findFirstOrThrow({ where: { orderId: orderAtA } });
      const job = await fx.prisma.printJob.create({
        data: {
          orderId: orderAtA,
          shopId: fx.shop.id,
          branchId: fx.branch.id,
          orderItemId: item.id,
          printerId: printerAtB.id,
          attempt: 1,
          idempotencyToken: `${item.id}:1`,
          status: PrintJobStatus.QUEUED,
        },
      });

      const claim = await http()
        .post(`/v1/agents/jobs/${job.id}/claim`)
        .set(bearer(agent.accessToken))
        .send({});
      expect(claim.status).toBe(404);
      expect(claim.body.error_code).toBe("JOB_NOT_FOUND");
      expect((await fx.prisma.printJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
        PrintJobStatus.QUEUED,
      );
    });

    it("a hand-registered printer takes the branch the same way a code does", async () => {
      const register = (actor: { token: string }, extra: Record<string, unknown>) =>
        http()
          .post("/v1/shop/printers")
          .set(bearer(actor.token))
          .send({ shopId: fx.shop.id, name: unique("manual"), ...extra });
      expect((await register(owner() as never as { token: string }, {})).status).toBe(401);
      const asked = await register({ token: fx.token }, {});
      expect(asked.status).toBe(400);
      expect(asked.body.error_code).toBe("BRANCH_REQUIRED");
      const own = await register(managerB, {});
      expect(own.status).toBe(201);
      expect(own.body.branchId).toBe(branchB.id);
      expect((await register(managerB, { branchId: fx.branch.id })).status).toBe(403);
      const named = await register(roaming, { branchId: branchB.id });
      expect(named.body.branchId).toBe(branchB.id);
      const unknown = await register({ token: fx.token }, { branchId: otherShopBranchId });
      expect(unknown.status).toBe(400);
      expect(unknown.body.error_code).toBe("BRANCH_NOT_FOUND");
    });
  });

  describe("moving a PC to another branch", () => {
    const move = (
      printerId: string,
      branchId: unknown,
      actor: { token: string } = { token: fx.token },
    ) =>
      http()
        .put(`/v1/shop/printers/${printerId}/branch`)
        .set(bearer(actor.token))
        .send(branchId === undefined ? {} : { branchId });

    async function twoPrinterPc(branchId: string) {
      const { agent } = await pair(branchId);
      const names = [unique("pc-printer-1"), unique("pc-printer-2")];
      expect((await heartbeat(agent, names)).status).toBe(200);
      const printers = await fx.prisma.printer.findMany({
        where: { agentId: agent.agentId },
        orderBy: { name: "asc" },
      });
      expect(printers).toHaveLength(2);
      return { agent, printers, names };
    }

    it("moves the PC and every printer on it, keeping their history", async () => {
      const { agent, printers } = await twoPrinterPc(fx.branch.id);
      await fx.prisma.printerPageUsage.create({
        data: {
          printerId: printers[0]!.id,
          periodStart: new Date("2026-01-01T00:00:00Z"),
          pagesUsed: 42,
        },
      });
      const res = await move(printers[0]!.id, branchB.id);
      expect(res.status).toBe(200);
      const moved = res.body as Array<{ id: string; branchId: string; branchName: string }>;
      expect(moved.map((p) => p.id).sort()).toEqual(printers.map((p) => p.id).sort());
      expect(moved.every((p) => p.branchId === branchB.id && p.branchName === branchB.name)).toBe(
        true,
      );

      expect(
        (await fx.prisma.printerAgent.findUniqueOrThrow({ where: { id: agent.agentId } })).branchId,
      ).toBe(branchB.id);
      const rows = await fx.prisma.printer.findMany({ where: { agentId: agent.agentId } });
      expect(rows.every((p) => p.branchId === branchB.id)).toBe(true);
      const usage = await fx.prisma.printerPageUsage.findMany({
        where: { printerId: printers[0]!.id },
      });
      expect(usage).toHaveLength(1);
      expect(usage[0]!.pagesUsed).toBe(42);

      const audit = await fx.prisma.auditLog.findFirstOrThrow({
        where: { action: "PRINTER_BRANCH_MOVED", resourceId: agent.agentId },
      });
      expect(audit.actorId).toBe(fx.owner.id);
      expect(audit.metadata).toMatchObject({
        fromBranchId: fx.branch.id,
        toBranchId: branchB.id,
      });
    });

    it("keeps the moved PC's printers matched by the heartbeat, and puts a new one at the new branch", async () => {
      const { agent, names } = await twoPrinterPc(fx.branch.id);
      const one = (await fx.prisma.printer.findFirstOrThrow({ where: { agentId: agent.agentId } }))
        .id;
      expect((await move(one, branchB.id)).status).toBe(200);

      const extra = unique("pc-new-printer");
      expect((await heartbeat(agent, [...names, extra])).status).toBe(200);
      for (const name of names) {
        const rows = await printersNamed(name);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.branchId).toBe(branchB.id);
      }
      const created = await printersNamed(extra);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ branchId: branchB.id, agentId: agent.agentId });
    });

    it("is refused while any printer of the PC has a queued, claimed or printing job, and allowed once it is done", async () => {
      for (const status of [
        PrintJobStatus.QUEUED,
        PrintJobStatus.CLAIMED,
        PrintJobStatus.PRINTING,
      ]) {
        const { agent, printers } = await twoPrinterPc(fx.branch.id);
        // The job is on the SECOND printer: the whole PC is held, not just the one named.
        const order = (
          await fx.makeOrder(1, 1, OrderStatus.QUEUED_FOR_PRINT, undefined, fx.branch.id)
        ).orderId;
        const item = await fx.prisma.orderItem.findFirstOrThrow({ where: { orderId: order } });
        const job = await fx.prisma.printJob.create({
          data: {
            orderId: order,
            shopId: fx.shop.id,
            branchId: fx.branch.id,
            orderItemId: item.id,
            printerId: printers[1]!.id,
            attempt: 1,
            idempotencyToken: `${item.id}:1`,
            status,
          },
        });
        const refused = await move(printers[0]!.id, branchB.id);
        expect(refused.status).toBe(409);
        expect(refused.body.error_code).toBe("AGENT_HAS_ACTIVE_JOBS");
        expect(
          (await fx.prisma.printerAgent.findUniqueOrThrow({ where: { id: agent.agentId } }))
            .branchId,
        ).toBe(fx.branch.id);
        expect(
          (await fx.prisma.printer.findMany({ where: { agentId: agent.agentId } })).every(
            (p) => p.branchId === fx.branch.id,
          ),
        ).toBe(true);

        await fx.prisma.printJob.update({
          where: { id: job.id },
          data: { status: PrintJobStatus.PRINTED },
        });
        expect((await move(printers[0]!.id, branchB.id)).status).toBe(200);
        // The finished job stays where it was printed.
        expect(
          (await fx.prisma.printJob.findUniqueOrThrow({ where: { id: job.id } })).branchId,
        ).toBe(fx.branch.id);
      }
    });

    it("needs MANAGE_SETTINGS: only an owner can move a PC", async () => {
      const { printers } = await twoPrinterPc(fx.branch.id);
      for (const person of [managerA, managerB, roaming, counterB]) {
        const res = await move(printers[0]!.id, branchB.id, person);
        expect(res.status).toBe(403);
      }
      const row = await fx.prisma.printer.findUniqueOrThrow({ where: { id: printers[0]!.id } });
      expect(row.branchId).toBe(fx.branch.id);
      expect((await move(printers[0]!.id, branchB.id)).status).toBe(200);
    });

    it("refuses an unknown, another business's or archived destination, and a missing one", async () => {
      const { printers } = await twoPrinterPc(fx.branch.id);
      for (const branchId of [randomUUID(), otherShopBranchId]) {
        const res = await move(printers[0]!.id, branchId);
        expect(res.status).toBe(400);
        expect(res.body.error_code).toBe("BRANCH_NOT_FOUND");
      }
      const spare = await fx.addBranch("Archived destination");
      await fx.prisma.branch.update({ where: { id: spare.id }, data: { archivedAt: new Date() } });
      const archived = await move(printers[0]!.id, spare.id);
      expect(archived.status).toBe(409);
      expect(archived.body.error_code).toBe("BRANCH_ARCHIVED");
      expect((await move(printers[0]!.id, undefined)).status).toBe(400);
      expect((await move(printers[0]!.id, "not-a-uuid")).status).toBe(400);
      expect((await move(randomUUID(), branchB.id)).status).toBe(403);
      const row = await fx.prisma.printer.findUniqueOrThrow({ where: { id: printers[0]!.id } });
      expect(row.branchId).toBe(fx.branch.id);
    });

    it("moving to the branch it is already at changes nothing", async () => {
      const { printers } = await twoPrinterPc(fx.branch.id);
      const before = await fx.prisma.auditLog.count({ where: { action: "PRINTER_BRANCH_MOVED" } });
      const res = await move(printers[0]!.id, fx.branch.id);
      expect(res.status).toBe(200);
      expect((res.body as unknown[]).length).toBe(2);
      expect(await fx.prisma.auditLog.count({ where: { action: "PRINTER_BRANCH_MOVED" } })).toBe(
        before,
      );
    });

    it("moves a hand-registered printer (no PC) on its own", async () => {
      const made = await http()
        .post("/v1/shop/printers")
        .set(owner())
        .send({ shopId: fx.shop.id, branchId: fx.branch.id, name: unique("lonely") });
      const res = await move(made.body.id, branchB.id);
      expect(res.status).toBe(200);
      expect((res.body as Array<{ id: string }>).map((p) => p.id)).toEqual([made.body.id]);
      expect(
        (await fx.prisma.printer.findUniqueOrThrow({ where: { id: made.body.id } })).branchId,
      ).toBe(branchB.id);
    });

    it("a move that loses a race with a PC claiming the printer is refused, not half done", async () => {
      // A hand-registered printer (no PC) at A, and a PC at A that is about to report it.
      const made = await http()
        .post("/v1/shop/printers")
        .set(owner())
        .send({ shopId: fx.shop.id, branchId: fx.branch.id, name: unique("claimed-midway") });
      expect(made.status).toBe(201);
      const { agent } = await pair(fx.branch.id);

      // The heartbeat's write, frozen half way: it holds the printer row and links it to the PC,
      // and only commits after the move request has arrived and started waiting for that row.
      const claiming = fx.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM printers WHERE id = ${made.body.id} FOR UPDATE`;
          await tx.printer.update({
            where: { id: made.body.id },
            data: { agentId: agent.agentId },
          });
          await new Promise((resolve) => setTimeout(resolve, 1500));
        },
        { timeout: 20_000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      const [, moved] = await Promise.all([claiming, move(made.body.id, branchB.id)]);

      // The move decided on a stale picture (no PC), so it must not move the printer on its own
      // and strand it away from the PC that now owns it.
      expect(moved.status).toBe(409);
      const printer = await fx.prisma.printer.findUniqueOrThrow({ where: { id: made.body.id } });
      const pc = await fx.prisma.printerAgent.findUniqueOrThrow({ where: { id: agent.agentId } });
      expect(printer.agentId).toBe(agent.agentId);
      expect(printer.branchId).toBe(pc.branchId);
      expect(pc.branchId).toBe(fx.branch.id);
    }, 30_000);

    it("a move racing an accepted order never leaves a job on a printer of another branch", async () => {
      for (let round = 0; round < 6; round += 1) {
        const { printers } = await twoPrinterPc(fx.branch.id);
        // Only this PC's printers can take the job, so the race is about exactly them.
        await fx.prisma.printer.updateMany({
          where: { shopId: fx.shop.id, id: { notIn: printers.map((p) => p.id) } },
          data: { status: PrinterStatus.DISABLED },
        });
        const order = (
          await fx.makeOrder(1, 1, OrderStatus.WAITING_FOR_SHOP, undefined, fx.branch.id)
        ).orderId;
        const [accepted, moved] = await Promise.all([
          http().post(`/v1/shop/orders/${order}/accept`).set(owner()).send({}),
          move(printers[0]!.id, branchB.id),
        ]);
        expect([200, 409]).toContain(accepted.status);
        expect([200, 409]).toContain(moved.status);

        // The invariant: every live job sits on a printer of its own branch.
        const jobs = await fx.prisma.printJob.findMany({
          where: { orderId: order, supersededAt: null },
          include: { printer: { select: { branchId: true } } },
        });
        for (const job of jobs) {
          if (job.printer) expect(job.printer.branchId).toBe(job.branchId);
        }
        // And if the PC moved, no job of the old branch is still queued on it.
        if (moved.status === 200) {
          const stranded = await fx.prisma.printJob.count({
            where: {
              branchId: fx.branch.id,
              printerId: { in: printers.map((p) => p.id) },
              status: {
                in: [PrintJobStatus.QUEUED, PrintJobStatus.CLAIMED, PrintJobStatus.PRINTING],
              },
            },
          });
          expect(stranded).toBe(0);
        }
      }
    }, 60_000);
  });
});
