import { createZodDto } from "nestjs-zod";
import { reassignJobSchema } from "@print-automated/validation";

export class ReassignJobDto extends createZodDto(reassignJobSchema) {}
