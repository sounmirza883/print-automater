import { createZodDto } from "nestjs-zod";
import { createQuoteSchema } from "@print-automated/validation";

// Same shape as a quote request -- §20's own requirement ("recomputes
// price server-side") means order creation takes exactly the inputs a
// quote does (document, shop, configuration) and nothing resembling a
// price, so there is nothing new to validate here.
export class CreateOrderDto extends createZodDto(createQuoteSchema) {}
