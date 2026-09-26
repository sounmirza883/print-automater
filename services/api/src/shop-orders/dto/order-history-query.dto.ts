import { createZodDto } from "nestjs-zod";
import { orderHistoryQuerySchema } from "@print-automated/validation";

export class OrderHistoryQueryDto extends createZodDto(orderHistoryQuerySchema) {}
