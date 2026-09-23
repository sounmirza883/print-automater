import { createZodDto } from "nestjs-zod";
import { listCustomersQuerySchema } from "@print-automated/validation";

export class ListCustomersQueryDto extends createZodDto(listCustomersQuerySchema) {}
