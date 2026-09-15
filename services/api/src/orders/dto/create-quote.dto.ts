import { createZodDto } from "nestjs-zod";
import { createQuoteSchema } from "@print-automated/validation";

export class CreateQuoteDto extends createZodDto(createQuoteSchema) {}
