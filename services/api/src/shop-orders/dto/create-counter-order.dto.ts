import { createZodDto } from "nestjs-zod";
import { createCounterOrderSchema } from "@print-automated/validation";

export class CreateCounterOrderDto extends createZodDto(createCounterOrderSchema) {}
