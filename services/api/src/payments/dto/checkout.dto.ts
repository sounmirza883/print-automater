import { createZodDto } from "nestjs-zod";
import { checkoutSchema } from "@print-automated/validation";

export class CheckoutDto extends createZodDto(checkoutSchema) {}
