import { z } from "zod";
import { paginationQuerySchema, queryBooleanSchema } from "../common/pagination.schema.js";

/** Filters shared by the notification list, unread count and read-all:
 *  - `audience` narrows the merged feed to a customer's order notices or a staff member's
 *    operational alerts (default: both);
 *  - `shopId` narrows to one business's staff alerts (it implies `audience=staff`). */
export const notificationFilterSchema = z.object({
  audience: z.enum(["customer", "staff"]).optional(),
  shopId: z.string().uuid().optional(),
});
export type NotificationFilterInput = z.infer<typeof notificationFilterSchema>;

/** `GET /notifications`: newest first, always a page (limit 1-100, default 50).
 * `unread=true|false` shows only unread / only read ones. */
export const listNotificationsQuerySchema = notificationFilterSchema
  .extend({ unread: queryBooleanSchema.optional() })
  .merge(paginationQuerySchema);
export type ListNotificationsQueryInput = z.infer<typeof listNotificationsQuerySchema>;
