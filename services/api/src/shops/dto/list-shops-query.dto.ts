import { createZodDto } from "nestjs-zod";
import { listShopsQuerySchema } from "@print-automated/validation";

export class ListShopsQueryDto extends createZodDto(listShopsQuerySchema) {}
