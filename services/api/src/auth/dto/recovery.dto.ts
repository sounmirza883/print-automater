import { createZodDto } from "nestjs-zod";
import { recoverySchema } from "@print-automated/validation";

export class RecoveryDto extends createZodDto(recoverySchema) {}
