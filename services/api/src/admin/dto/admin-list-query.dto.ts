import { createZodDto } from "nestjs-zod";
import { adminListQuerySchema } from "@print-automated/validation";

export class AdminListQueryDto extends createZodDto(adminListQuerySchema) {}
