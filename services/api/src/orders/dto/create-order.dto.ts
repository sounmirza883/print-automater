import { createZodDto } from "nestjs-zod";
import { createOrderSchema } from "@print-automated/validation";

// Same shape as a quote request -- §20's own requirement ("recomputes
// price server-side") means order creation takes exactly the inputs a
// quote does (document, shop, configuration) and nothing resembling a
// price -- plus, since step 3, the branch the customer is ordering from.
export class CreateOrderDto extends createZodDto(createOrderSchema) {}
