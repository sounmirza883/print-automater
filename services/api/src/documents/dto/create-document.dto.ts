import { createZodDto } from "nestjs-zod";
import { createDocumentSchema } from "@print-automated/validation";

export class CreateDocumentDto extends createZodDto(createDocumentSchema) {}
