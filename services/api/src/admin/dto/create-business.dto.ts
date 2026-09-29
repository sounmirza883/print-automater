import { createZodDto } from "nestjs-zod";
import { createBusinessSchema } from "@print-automated/validation";

export class CreateBusinessDto extends createZodDto(createBusinessSchema) {}
