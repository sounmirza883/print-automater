import { Prisma } from "@prisma/client";

/** 23.2/23.5: SQL twin of `jobPages()` (packages/backend-shared job-pages.ts, the ONE
 * definition of how many pages a print job consumes): resolved pages of one copy
 * (a page range counts only its range, "all" means the document's page count, an
 * unknown page count counts as 1) x copies (the order item's quantity, else the
 * configuration's copies, else 1). Aggregates cannot call the TypeScript helper
 * per row, so job-pages-sql.e2e proves this expression equals `jobPages()` on a
 * table of cases. Use with `JOB_PAGES_JOINS` (aliases j, o, oi, d). */
export const JOB_PAGES_JOINS = Prisma.sql`
  JOIN orders o ON o.id = j.order_id
  LEFT JOIN order_items oi ON oi.id = j.order_item_id
  LEFT JOIN documents d ON d.id = COALESCE(oi.document_id, o.document_id)`;

const CONFIG = Prisma.sql`COALESCE(oi.print_configuration, o.print_configuration)`;

export const JOB_PAGES_PER_COPY = Prisma.sql`(
  CASE
    WHEN ${CONFIG}->'pages'->>'mode' = 'range'
      AND (${CONFIG}->'pages'->>'from') ~ '^[0-9]+$'
      AND (${CONFIG}->'pages'->>'to') ~ '^[0-9]+$'
      AND (${CONFIG}->'pages'->>'to')::int >= (${CONFIG}->'pages'->>'from')::int
      AND (${CONFIG}->'pages'->>'from')::int >= 1
      AND (${CONFIG}->'pages'->>'to')::int <= COALESCE(d.page_count, 1)
    THEN (${CONFIG}->'pages'->>'to')::int - (${CONFIG}->'pages'->>'from')::int + 1
    ELSE COALESCE(d.page_count, 1)
  END)`;

export const JOB_COPIES = Prisma.sql`COALESCE(
  oi.quantity,
  CASE WHEN (${CONFIG}->>'copies') ~ '^[0-9]+$' THEN (${CONFIG}->>'copies')::int END,
  1)`;

export const JOB_TOTAL_PAGES = Prisma.sql`(${JOB_PAGES_PER_COPY} * ${JOB_COPIES})`;
