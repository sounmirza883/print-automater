import { createZodDto } from "nestjs-zod";
import { pauseJobSchema } from "@print-automated/validation";

export class PauseJobDto extends createZodDto(pauseJobSchema) {}
