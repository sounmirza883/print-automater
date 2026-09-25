import { PrintJobStatus, type Prisma } from "@prisma/client";
import { periodStart } from "../printers/page-limit-period.js";
import type { PrinterCandidate } from "./allocate-printer.js";
import { jobPages, type JobConfig } from "./job-pages.js";
import { logJobPagesFallback } from "./job-pages-log.js";
import { readShopAutomation, type ShopAutomation } from "../settings/shop-automation.js";

export interface PrinterCandidateSet {
  candidates: PrinterCandidate[];
  /** printerId -> owning agent's deviceId (PrinterCandidate stays pure and
   * carries no device concept). */
  deviceIdsByPrinterId: Map<string, string>;
  /** 22.2: the shop's automation switches, read in the same transaction as the
   * candidates so one allocation decision sees one consistent snapshot. */
  automation: ShopAutomation;
}

/** 19.2/19.4. Builds allocation candidates for every printer in a shop from
 * live rows: queue load (QUEUED/CLAIMED/PRINTING, non-superseded, measured
 * with `jobPages()`) and, only when `pageLimitEnabled` AND `pageLimit` is
 * set, the remaining allowance from the current period's usage row. The limit is a
 * SOFT cap: usage counts completed pages only, so jobs allocated together can
 * overshoot it. Changing a printer's period mid-month (DAILY -> MONTHLY) uses
 * a different period key, effectively resetting the allowance. Lives in
 * backend-shared so the worker's offline sweep (19.5) can reuse it. `now` is
 * passed in. Queued-but-unprinted pages are deliberately NOT subtracted from
 * the allowance: usage counts completed pages only (accrual is on PRINTED). */
export async function buildPrinterCandidates(
  tx: Prisma.TransactionClient,
  shopId: string,
  now: Date,
): Promise<PrinterCandidateSet> {
  const printers = await tx.printer.findMany({
    where: { shopId },
    include: { agent: { select: { deviceId: true } } },
  });
  const deviceIdsByPrinterId = new Map(
    printers.filter((p) => p.agent).map((p) => [p.id, p.agent!.deviceId]),
  );

  const activeJobs = await tx.printJob.findMany({
    where: {
      shopId,
      supersededAt: null,
      printerId: { not: null },
      status: { in: [PrintJobStatus.QUEUED, PrintJobStatus.CLAIMED, PrintJobStatus.PRINTING] },
    },
    select: {
      id: true,
      orderId: true,
      printerId: true,
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
  const load = new Map<string, { pages: number; jobs: number }>();
  for (const job of activeJobs) {
    const pages = jobPages(
      (job.orderItem?.printConfiguration ?? job.order.printConfiguration) as unknown as JobConfig,
      job.orderItem?.document.pageCount ?? job.order.document.pageCount,
      job.orderItem?.quantity,
      logJobPagesFallback({
        jobId: job.id,
        orderId: job.orderId,
        documentId: job.orderItem?.documentId ?? job.order.documentId,
      }),
    ).total;
    const entry = load.get(job.printerId!) ?? { pages: 0, jobs: 0 };
    entry.pages += pages;
    entry.jobs += 1;
    load.set(job.printerId!, entry);
  }

  // 22.2: the page-limit toggle switches ENFORCEMENT off (no allowance is passed to
  // the allocator, so nothing is ever excluded for it); usage keeps being accrued
  // elsewhere, so switching it back on has accurate data.
  const automation = await readShopAutomation(tx, shopId);
  const limited = automation.pageLimitEnforcement
    ? printers.filter((p) => p.pageLimitEnabled && p.pageLimit !== null)
    : [];
  const usage = new Map<string, number>();
  for (const printer of limited) {
    const row = await tx.printerPageUsage.findUnique({
      where: {
        printerId_periodStart: {
          printerId: printer.id,
          periodStart: periodStart(printer.pageLimitPeriod, now),
        },
      },
      select: { pagesUsed: true },
    });
    usage.set(printer.id, row?.pagesUsed ?? 0);
  }

  const candidates: PrinterCandidate[] = printers.map((printer) => ({
    id: printer.id,
    status: printer.status,
    hasAgent: printer.agentId !== null,
    capabilities: printer.capabilities as PrinterCandidate["capabilities"],
    supportedSizes: printer.supportedSizes,
    supportedPaperTypes: printer.supportedPaperTypes,
    maxJobPages: printer.maxJobPages,
    queuedPages: load.get(printer.id)?.pages ?? 0,
    queuedJobs: load.get(printer.id)?.jobs ?? 0,
    registeredAt: printer.createdAt.getTime(),
    pageLimitRemaining: usage.has(printer.id)
      ? Math.max(0, printer.pageLimit! - usage.get(printer.id)!)
      : null,
  }));
  return { candidates, deviceIdsByPrinterId, automation };
}
