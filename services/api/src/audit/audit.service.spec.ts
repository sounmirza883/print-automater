import { randomUUID } from "node:crypto";
import { UserRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuditService } from "./audit.service.js";

describe("AuditService (integration)", () => {
  let prisma: PrismaService;
  let auditService: AuditService;
  let testUser: { id: string };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    auditService = new AuditService(prisma);

    testUser = await prisma.user.create({
      data: {
        role: UserRole.CUSTOMER,
        name: "Audit Test User",
        email: `audit-test-${randomUUID()}@print-automated.dev`,
        passwordHash: "irrelevant",
      },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: testUser.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
    await prisma.$disconnect();
  });

  it("writes an append-only row with the given actor/action/resource", async () => {
    await auditService.record({
      actorId: testUser.id,
      action: "LOGIN",
      resourceType: "user",
      resourceId: testUser.id,
    });

    const rows = await prisma.auditLog.findMany({ where: { actorId: testUser.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: testUser.id,
      action: "LOGIN",
      resourceType: "user",
      resourceId: testUser.id,
    });
  });

  it("a password field passed in metadata is redacted before it's persisted", async () => {
    await auditService.record({
      actorId: testUser.id,
      action: "LOGIN_ATTEMPT",
      resourceType: "user",
      resourceId: testUser.id,
      metadata: { email: testUser.id, password: "hunter2", nested: { token: "abc123" } },
    });

    const row = await prisma.auditLog.findFirst({
      where: { actorId: testUser.id, action: "LOGIN_ATTEMPT" },
    });
    expect(row?.metadata).toEqual({
      email: testUser.id,
      password: "[REDACTED]",
      nested: { token: "[REDACTED]" },
    });
  });
});
