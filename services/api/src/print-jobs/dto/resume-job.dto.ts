import { createZodDto } from "nestjs-zod";
import { resumeJobSchema } from "@print-automated/validation";

export class ResumeJobDto extends createZodDto(resumeJobSchema) {}
