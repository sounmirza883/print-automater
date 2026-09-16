import { createZodDto } from "nestjs-zod";
import { pollJobsQuerySchema } from "@print-automated/validation";

export class PollJobsQueryDto extends createZodDto(pollJobsQuerySchema) {}
