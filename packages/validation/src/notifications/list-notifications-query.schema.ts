import { z } from "zod";
import { paginationQuerySchema, queryBooleanSchema } from "../common/pagination.schema.js";

const filterShape = {
  audience: z.enum(["customer", "staff"]).optional(),
  shopId: z.string().uuid().optional(),
};

/** `shopId` selects one business's STAFF alerts, so combining it with `audience=customer` is
 * a contradiction. It is refused (400) on every notification route rather than answered
 * differently by each. */
const consistent = (value: { audience?: string; shopId?: string }): boolean =>
  !(value.shopId && value.audience === "customer");
const inconsistentMessage = {
  message: "`shopId` selects staff alerts and cannot be combined with `audience=customer`.",
  path: ["audience"],
};

/** Filters shared by the notification list, unread count and read-all:
 *  - `audience` narrows the merged feed to a customer's order notices or a staff member's
 *    operational alerts (default: both);
 *  - `shopId` narrows to one business's staff alerts (it implies `audience=staff`). */
export const notificationFilterSchema = z
  .object(filterShape)
  .refine(consistent, inconsistentMessage);
export type NotificationFilterInput = z.infer<typeof notificationFilterSchema>;

/** `GET /notifications`: newest first, always a page (limit 1-100, default 50, offset <= 10000).
 * `unread=true|false` shows only unread / only read ones. */
export const listNotificationsQuerySchema = z
  .object({ ...filterShape, unread: queryBooleanSchema.optional() })
  .merge(paginationQuerySchema)
  .refine(consistent, inconsistentMessage);
export type ListNotificationsQueryInput = z.infer<typeof listNotificationsQuerySchema>;
