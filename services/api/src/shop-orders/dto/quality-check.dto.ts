import { createZodDto } from "nestjs-zod";
import { qualityCheckSchema } from "@print-automated/validation";

export class QualityCheckDto extends createZodDto(qualityCheckSchema) {}
