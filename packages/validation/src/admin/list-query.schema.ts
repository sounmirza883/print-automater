import { z } from "zod";
import { MAX_PAGE_OFFSET } from "../common/pagination.schema.js";

/** §42/16.5: every admin list route is bounded, never an unfiltered dump -- the page size
 * is capped at 200 since these routes see every business/user/audit row on the platform.
 * 23.6: `limit`/`offset` are accepted as the platform-wide names for `take`/`skip` (which
 * keep working); both spellings resolve to the same `take`/`skip`, and the responses now
 * also echo `limit`/`offset` next to `items`/`total`. */
const ADMIN_MAX_PAGE = 200;
export const adminPagingShape = {
  take: z.coerce.number().int().min(1).max(ADMIN_MAX_PAGE).optional(),
  skip: z.coerce.number().int().min(0).max(MAX_PAGE_OFFSET).optional(),
  limit: z.coerce.number().int().min(1).max(ADMIN_MAX_PAGE).optional(),
  offset: z.coerce.number().int().min(0).max(MAX_PAGE_OFFSET).optional(),
};

function resolveAdminPaging<
  T extends { take?: number; skip?: number; limit?: number; offset?: number },
>(value: T): Omit<T, "take" | "skip" | "limit" | "offset"> & { take: number; skip: number } {
  const { take, skip, limit, offset, ...rest } = value;
  return { ...rest, take: limit ?? take ?? 50, skip: offset ?? skip ?? 0 };
}

export const adminListQuerySchema = z.object(adminPagingShape).transform(resolveAdminPaging);

export type AdminListQueryInput = z.infer<typeof adminListQuerySchema>;

/** §45/16.6: `GET /admin/audit`'s own filters -- resourceType, actorId
 * and a createdAt range are the useful axes an audit reader actually
 * needs (matching the plan's own suggested set), not every column. */
export const adminAuditQuerySchema = z
  .object({
    ...adminPagingShape,
    resourceType: z.string().min(1).optional(),
    actorId: z.string().uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .transform(resolveAdminPaging);

export type AdminAuditQueryInput = z.infer<typeof adminAuditQuerySchema>;
