import { createZodDto } from "nestjs-zod";
import { listOrdersQuerySchema } from "@print-automated/validation";

export class ListOrdersQueryDto extends createZodDto(listOrdersQuerySchema) {}
