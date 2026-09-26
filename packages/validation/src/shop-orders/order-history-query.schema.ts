import { z } from "zod";
import { paginationQuerySchema } from "../common/pagination.schema.js";

/** 23.13 `GET /shop/orders/:id/history`: always a page (limit 1-100, default 50; offset
 * capped at 10000 like every list). Oldest first: it is a timeline. */
export const orderHistoryQuerySchema = paginationQuerySchema;

export type OrderHistoryQueryInput = z.infer<typeof orderHistoryQuerySchema>;
