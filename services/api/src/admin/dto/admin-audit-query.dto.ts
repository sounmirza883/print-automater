import { createZodDto } from "nestjs-zod";
import { adminAuditQuerySchema } from "@print-automated/validation";

export class AdminAuditQueryDto extends createZodDto(adminAuditQuerySchema) {}
