import { createZodDto } from "nestjs-zod";
import { updateProductSchema } from "@print-automated/validation";

export class UpdateProductDto extends createZodDto(updateProductSchema) {}
