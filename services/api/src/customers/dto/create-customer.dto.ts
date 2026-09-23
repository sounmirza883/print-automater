import { createZodDto } from "nestjs-zod";
import { createCustomerSchema } from "@print-automated/validation";

export class CreateCustomerDto extends createZodDto(createCustomerSchema) {}
