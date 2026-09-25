import { createZodDto } from "nestjs-zod";
import { reprintJobSchema } from "@print-automated/validation";

export class ReprintJobDto extends createZodDto(reprintJobSchema) {}
