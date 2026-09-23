import { createZodDto } from "nestjs-zod";
import { assignOperatorSchema } from "@print-automated/validation";

export class AssignOperatorDto extends createZodDto(assignOperatorSchema) {}
