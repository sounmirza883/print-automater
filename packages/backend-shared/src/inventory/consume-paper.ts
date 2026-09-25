import type { Prisma } from "@prisma/client";
import type { PrintConfiguration } from "@print-automated/types";
import { redactMetadata } from "../audit/redact-metadata.js";
import { jobPages, type JobConfig } from "../print-jobs/job-pages.js";
import { logJobPagesFallback } from "../print-jobs/job-pages-log.js";
import { isInventoryTrackingEnabled, paperNeedFor, type PaperNeed } from "./paper-availability.js";
import { applyStockMovement } from "./stock-movement.js";

export const INVENTORY_SHORTFALL_AUDIT_ACTION = "INVENTORY_SHORTFALL";

export interface PaperConsumptionResult {
  consumedSheets: number;
  shortfallSheets: number;
}

/** Pure: the order in which matching stock lines are drawn down. An item whose
 * type is exactly the job's goes first (the paper the job asked for), then
 * untyped ("any") items; ties by most stock, then id, so the choice is
 * deterministic. */
export function consumptionOrder<
  T extends { id: string; quantity: number; paperType: string | null },
>(items: readonly T[], need: Pick<PaperNeed, "paperType">): T[] {
  const rank = (item: T): number => (item.paperType === need.paperType ? 0 : 1);
  return [...items].sort(
    (a, b) =>
      rank(a) - rank(b) || b.quantity - a.quantity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** 20.4 / PRD 28, 100. Runs INSIDE the job state machine's own PRINTED
 * transaction (PRINTED and RESOLVE_PRINTED both land there), so the paper is
 * counted exactly when, and only when, the job becomes PRINTED: it commits or
 * rolls back with the status, and a job can only reach PRINTED once (a replay
 * is rejected as an illegal transition before this runs).
 *
 * - No-op unless the shop enabled inventory tracking (flag off = today's
 *   behaviour exactly, no rows written).
 * - Idempotent twice over: it does nothing if the job already has a CONSUMPTION
 *   movement, and each per-item movement carries the unique key
 *   `consumption:<jobId>:<itemId>` so the database itself refuses a duplicate.
 * - Never fails or blocks the print: the paper is already on the tray, so it
 *   draws with CLAMP (take what is there, floor at zero, never negative) and
 *   records any shortfall as an INVENTORY_SHORTFALL audit row for staff to
 *   reconcile. The cost is that stock can read 0 while real paper remains; the
 *   opposite (refusing to record a completed print) would corrupt the job.
 * - Locks: the caller already holds `orders` then `print_jobs`; matching items
 *   are then locked in ascending id (the same order purchase-order receipt
 *   uses), so two completions and a receipt cannot deadlock.
 *
 * Only stock lines matching the job's paper are touched (`paperItemMatches`,
 * mirrored here in SQL). */
export async function consumePaperForJob(
  tx: Prisma.TransactionClient,
  input: { jobId: string; actorId: string | null },
): Promise<PaperConsumptionResult | null> {
  const job = await tx.printJob.findUniqueOrThrow({
    where: { id: input.jobId },
    select: {
      shopId: true,
      orderId: true,
      orderItem: {
        select: {
          documentId: true,
          quantity: true,
          printConfiguration: true,
          document: { select: { pageCount: true } },
        },
      },
      order: {
        select: {
          documentId: true,
          printConfiguration: true,
          document: { select: { pageCount: true } },
        },
      },
    },
  });
  if (!(await isInventoryTrackingEnabled(tx, job.shopId))) {
    return null;
  }
  const already = await tx.inventoryMovement.findFirst({
    where: { printJobId: input.jobId, type: "CONSUMPTION" },
    select: { id: true },
  });
  if (already) {
    return null;
  }

  const config = (job.orderItem?.printConfiguration ??
    job.order.printConfiguration) as unknown as PrintConfiguration;
  const pages = jobPages(
    config as unknown as JobConfig,
    job.orderItem?.document.pageCount ?? job.order.document.pageCount,
    job.orderItem?.quantity,
    logJobPagesFallback({
      jobId: input.jobId,
      orderId: job.orderId,
      documentId: job.orderItem?.documentId ?? job.order.documentId,
    }),
  );
  const need = paperNeedFor(config, pages);

  // Lock every matching line in ascending id, then read the locked quantities.
  const locked = await tx.$queryRaw<
    Array<{ id: string; quantity: number; paperType: string | null }>
  >`
    SELECT id, quantity, paper_type AS "paperType"
    FROM inventory_items
    WHERE shop_id = ${job.shopId}
      AND active
      AND paper_size = ${need.paperSize}
      AND (paper_type IS NULL OR paper_type = ${need.paperType})
    ORDER BY id ASC
    FOR UPDATE
  `;

  let remaining = need.sheets;
  for (const item of consumptionOrder(locked, need)) {
    if (remaining === 0) break;
    const take = Math.min(remaining, item.quantity);
    if (take <= 0) continue;
    const result = await applyStockMovement(tx, {
      shopId: job.shopId,
      itemId: item.id,
      type: "CONSUMPTION",
      quantityDelta: -take,
      mode: "CLAMP",
      actorId: input.actorId,
      printJobId: input.jobId,
      idempotencyKey: `consumption:${input.jobId}:${item.id}`,
      reason: "Paper used by a completed print job",
    });
    if (result.outcome === "APPLIED") {
      remaining -= -result.appliedDelta;
    } else if (result.outcome === "DUPLICATE") {
      // Cannot happen after the check above (rows are locked); treat as done.
      return null;
    }
  }

  const consumedSheets = need.sheets - remaining;
  if (remaining > 0) {
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: INVENTORY_SHORTFALL_AUDIT_ACTION,
        resourceType: "print_job",
        resourceId: input.jobId,
        metadata: redactMetadata({
          shopId: job.shopId,
          paperSize: need.paperSize,
          paperType: need.paperType,
          requiredSheets: need.sheets,
          consumedSheets,
          shortfallSheets: remaining,
        }) as Prisma.InputJsonValue,
      },
    });
  }
  return { consumedSheets, shortfallSheets: remaining };
}

export const INVENTORY_CONSUMPTION_FAILED_AUDIT_ACTION = "INVENTORY_CONSUMPTION_FAILED";

/** 20.9. Consumption runs inside the job's PRINTED transaction, and in Postgres
 * any statement error (deadlock victim, lock timeout, serialization) aborts the
 * WHOLE transaction: without containment a stock-accounting failure would roll
 * back a print that already happened, leaving the job non-PRINTED while paper
 * sits in the tray (and a retry could print it twice). A SAVEPOINT around the
 * consumption lets a failure undo only the consumption's own writes
 * (ROLLBACK TO SAVEPOINT), after which the audit row is written and the
 * transition carries on to commit. Stock then reads high by the job's sheets
 * until staff reconcile from the INVENTORY_CONSUMPTION_FAILED audit row, the
 * safer direction. `hook` is a test seam that runs inside the savepoint. */
export async function consumePaperForJobContained(
  tx: Prisma.TransactionClient,
  input: { jobId: string; actorId: string | null },
  hook?: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<PaperConsumptionResult | null> {
  await tx.$executeRawUnsafe("SAVEPOINT inventory_consumption");
  try {
    if (hook) {
      await hook(tx);
    }
    const result = await consumePaperForJob(tx, input);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT inventory_consumption");
    return result;
  } catch (error) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT inventory_consumption");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT inventory_consumption");
    const job = await tx.printJob.findUnique({
      where: { id: input.jobId },
      select: { shopId: true },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        action: INVENTORY_CONSUMPTION_FAILED_AUDIT_ACTION,
        resourceType: "print_job",
        resourceId: input.jobId,
        metadata: redactMetadata({
          shopId: job?.shopId ?? null,
          error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
        }) as Prisma.InputJsonValue,
      },
    });
    return null;
  }
}
