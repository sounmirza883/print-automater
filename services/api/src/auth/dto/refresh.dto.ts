import { createZodDto } from "nestjs-zod";
import { refreshSchema } from "@print-automated/validation";

export class RefreshDto extends createZodDto(refreshSchema) {}
