import { createZodDto } from "nestjs-zod";
import { updateCustomerSchema } from "@print-automated/validation";

export class UpdateCustomerDto extends createZodDto(updateCustomerSchema) {}
