import { z } from "zod";

/** §42/16.5: every admin list route is bounded, never an unfiltered
 * dump -- `take` is capped, not just defaulted, since these routes see
 * every business/user/audit row on the platform, not one shop's worth.
 * Full pagination (23.6) is out of this sub-phase's scope; this is the
 * minimum bound needed for these routes to be safe to ship now. */
export const adminListQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

export type AdminListQueryInput = z.infer<typeof adminListQuerySchema>;

/** §45/16.6: `GET /admin/audit`'s own filters -- resourceType, actorId
 * and a createdAt range are the useful axes an audit reader actually
 * needs (matching the plan's own suggested set), not every column. */
export const adminAuditQuerySchema = adminListQuerySchema.extend({
  resourceType: z.string().min(1).optional(),
  actorId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type AdminAuditQueryInput = z.infer<typeof adminAuditQuerySchema>;
