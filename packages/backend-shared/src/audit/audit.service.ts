import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { redactMetadata } from "./redact-metadata.js";

export interface RecordAuditEntryInput {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

/** §83: append-only. Nothing in this codebase updates or deletes an
 * audit_logs row -- if that's ever needed, it's a deliberate, separate
 * decision, not something this service exposes. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEntryInput): Promise<void> {
    const metadata = input.metadata
      ? (redactMetadata(input.metadata) as Prisma.InputJsonValue)
      : undefined;

    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        metadata,
      },
    });
  }
}
