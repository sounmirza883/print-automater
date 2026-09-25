import { createZodDto } from "nestjs-zod";
import { reportQuerySchema } from "@print-automated/validation";

export class ReportQueryDto extends createZodDto(reportQuerySchema) {}
