import { createZodDto } from "nestjs-zod";
import { createProductSchema } from "@print-automated/validation";

export class CreateProductDto extends createZodDto(createProductSchema) {}
