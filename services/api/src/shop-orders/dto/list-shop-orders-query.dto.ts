import { createZodDto } from "nestjs-zod";
import { listShopOrdersQuerySchema } from "@print-automated/validation";

export class ListShopOrdersQueryDto extends createZodDto(listShopOrdersQuerySchema) {}
