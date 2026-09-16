import { createZodDto } from "nestjs-zod";
import { reportJobStatusSchema } from "@print-automated/validation";

export class ReportJobStatusDto extends createZodDto(reportJobStatusSchema) {}
