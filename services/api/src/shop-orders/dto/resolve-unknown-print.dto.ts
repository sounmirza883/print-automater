import { createZodDto } from "nestjs-zod";
import { resolveUnknownPrintSchema } from "@print-automated/validation";

export class ResolveUnknownPrintDto extends createZodDto(resolveUnknownPrintSchema) {}
