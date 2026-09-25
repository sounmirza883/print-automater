import { createZodDto } from "nestjs-zod";
import { recordFailureReasonSchema } from "@print-automated/validation";

export class RecordFailureReasonDto extends createZodDto(recordFailureReasonSchema) {}
