import { createZodDto } from "nestjs-zod";
import { activatePlanSchema } from "@print-automated/validation";

export class ActivatePlanDto extends createZodDto(activatePlanSchema) {}
