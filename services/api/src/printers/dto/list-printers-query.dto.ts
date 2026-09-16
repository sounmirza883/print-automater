import { createZodDto } from "nestjs-zod";
import { listPrintersQuerySchema } from "@print-automated/validation";

export class ListPrintersQueryDto extends createZodDto(listPrintersQuerySchema) {}
