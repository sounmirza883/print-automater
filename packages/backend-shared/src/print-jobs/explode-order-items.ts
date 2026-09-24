import type { PrintConfiguration } from "@print-automated/types";

/** 18.3/§64. The minimal shape `explodeOrderItems` needs from a real
 * `OrderItem` row -- deliberately not `Prisma.OrderItemGetPayload<...>`
 * itself, so this stays a plain, zero-Prisma pure function callable
 * from a unit test with a plain object literal. */
export interface OrderItemLike {
  id: string;
  documentId: string;
  printConfiguration: PrintConfiguration;
  required: boolean;
}

/** 18.3/§64. A print_jobs row not yet created -- everything
 * `allocatePrinter()` (18.4) and the job machine's own `create()`
 * (exempt from the print_jobs.status ESLint rule, same "an initial
 * value is not a transition" precedent order creation already
 * established) need to place and insert exactly one job per item. */
export interface PrintJobDraft {
  orderItemId: string;
  documentId: string;
  printConfiguration: PrintConfiguration;
  required: boolean;
  attempt: number;
}

/** 18.3. `OrderItem[] -> PrintJobDraft[]`, a plain 1:1 map -- every
 * item explodes into exactly one first-attempt job draft. No fan-out
 * (one item never produces more than one job) and no merging (two
 * items are never combined into one job) -- §64's own examples (100 A4
 * BW pages, 50 A4 color pages, 10 laminated pages, three items, three
 * jobs) are this simple by design; anything cleverer (e.g. splitting
 * one huge item across two printers) is out of this phase's scope. */
export function explodeOrderItems(items: readonly OrderItemLike[]): PrintJobDraft[] {
  return items.map((item) => ({
    orderItemId: item.id,
    documentId: item.documentId,
    // 18.25: deep copy -- a draft must never alias (and so be able to mutate)
    // the item it was exploded from.
    printConfiguration: structuredClone(item.printConfiguration),
    required: item.required,
    attempt: 1,
  }));
}
