import { createZodDto } from "nestjs-zod";
import { searchShopOrdersQuerySchema } from "@print-automated/validation";

export class SearchShopOrdersQueryDto extends createZodDto(searchShopOrdersQuerySchema) {}
