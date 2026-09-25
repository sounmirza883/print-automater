import { z } from "zod";
import { OrderStatus, PaymentStatus } from "@print-automated/types";
import { paginationQuerySchema } from "../common/pagination.schema.js";

/** 23.6 (PRD 43/44) `GET /shop/orders/search?shopId=`: one flat, paged (limit 1-100, default
 * 50) result, newest first. `q` matches the public order number, the customer's name /
 * phone / email (walk-in customer record, or the account that placed a web order) and the
 * name of any document on the order. The rest are exact filters and combine with AND:
 * order `status`, `paymentStatus`, a `from`/`to` range on createdAt (`to` inclusive of that
 * instant), `customerId` (a walk-in Customer record), `printerId` / `operatorId` (any live
 * job of the order is on that printer / assigned to that operator) and `priority` (any
 * live job has exactly that priority). */
export const searchShopOrdersQuerySchema = z
  .object({
    shopId: z.string().uuid(),
    q: z.string().trim().min(1).max(100).optional(),
    status: z.nativeEnum(OrderStatus).optional(),
    paymentStatus: z.nativeEnum(PaymentStatus).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    customerId: z.string().uuid().optional(),
    printerId: z.string().uuid().optional(),
    operatorId: z.string().uuid().optional(),
    priority: z.coerce.number().int().min(0).max(1000).optional(),
  })
  .merge(paginationQuerySchema)
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "`from` must not be after `to`.",
    path: ["from"],
  });

export type SearchShopOrdersQueryInput = z.infer<typeof searchShopOrdersQuerySchema>;
