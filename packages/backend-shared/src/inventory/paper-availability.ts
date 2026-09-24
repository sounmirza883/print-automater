import type { Prisma } from "@prisma/client";
import type { PrintConfiguration } from "@print-automated/types";
import type { PrinterCandidate } from "../print-jobs/allocate-printer.js";
import type { JobPages } from "../print-jobs/job-pages.js";

/** What one print job needs from paper stock. */
export interface PaperNeed {
  paperSize: string;
  /** Effective type: an absent `paperType` on a job means STANDARD paper
   * (PrintConfiguration's own documented meaning), never "any". */
  paperType: string;
  sheets: number;
}

/** The ONE sheet count, shared by the availability gate (20.3) and consumption
 * (20.4): single-sided is one sheet per page; double-sided prints two pages per
 * sheet, rounded UP per copy (an odd last page still uses a whole sheet); times
 * copies. `pagesPerCopy`/`copies` come from `jobPages()`. */
export function sheetsForJob(
  sides: string,
  pages: { pagesPerCopy: number; copies: number },
): number {
  const perCopy = sides === "DOUBLE" ? Math.ceil(pages.pagesPerCopy / 2) : pages.pagesPerCopy;
  return perCopy * pages.copies;
}

export function paperNeedFor(config: PrintConfiguration, pages: JobPages): PaperNeed {
  return {
    paperSize: config.paperSize,
    paperType: config.paperType ?? "STANDARD",
    sheets: sheetsForJob(config.sides, pages),
  };
}

/** The ONE matching rule between a job's paper and a stock line: an active item
 * of the same size whose type is the job's type, or an untyped item (untyped
 * means "any type", the natural reading of a shop that does not distinguish).
 * Inventory items without a paper size (toner, staples...) never match. The SQL
 * in `availablePaperSheets` and the consumption picker (20.4) express exactly
 * this rule; this function is what their tests pin it against. */
export function paperItemMatches(
  item: { active: boolean; paperSize: string | null; paperType: string | null },
  need: Pick<PaperNeed, "paperSize" | "paperType">,
): boolean {
  return (
    item.active &&
    item.paperSize === need.paperSize &&
    (item.paperType === null || item.paperType === need.paperType)
  );
}

/** Whether the shop has switched inventory tracking on (default false). */
export async function isInventoryTrackingEnabled(
  db: Prisma.TransactionClient,
  shopId: string,
): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ enabled: boolean }>>`
    SELECT inventory_tracking_enabled AS enabled FROM shops WHERE id = ${shopId}
  `;
  return rows[0]?.enabled === true;
}

/** Sheets in stock across every matching item (see `paperItemMatches`). */
export async function availablePaperSheets(
  db: Prisma.TransactionClient,
  shopId: string,
  need: Pick<PaperNeed, "paperSize" | "paperType">,
): Promise<number> {
  const rows = await db.$queryRaw<Array<{ total: number | bigint }>>`
    SELECT COALESCE(SUM(quantity), 0)::bigint AS total
    FROM inventory_items
    WHERE shop_id = ${shopId}
      AND active
      AND paper_size = ${need.paperSize}
      AND (paper_type IS NULL OR paper_type = ${need.paperType})
  `;
  return Number(rows[0]?.total ?? 0);
}

/** 20.3 / PRD 28. Sets `paperAvailable` on every candidate: true iff matching
 * stock covers this job's sheets. Applies ONLY when the shop has inventory
 * tracking enabled; when it is off the SAME array is returned untouched (no
 * `paperAvailable` field at all), so allocation is byte-for-byte what it was
 * before inventory existed. Paper is shop-level stock, so every candidate gets
 * the same answer; the gate is a point-in-time check, not a reservation (stock
 * is consumed when the job prints, 20.4). Only used on AUTOMATIC paths: a human
 * naming a printer overrides automation (PRD 20/122), like the page limit. */
export async function withPaperAvailability(
  db: Prisma.TransactionClient,
  shopId: string,
  candidates: PrinterCandidate[],
  need: PaperNeed,
): Promise<PrinterCandidate[]> {
  if (!(await isInventoryTrackingEnabled(db, shopId))) {
    return candidates;
  }
  const available = (await availablePaperSheets(db, shopId, need)) >= need.sheets;
  return candidates.map((candidate) => ({ ...candidate, paperAvailable: available }));
}
