import { createZodDto } from "nestjs-zod";
import { shopDashboardQuerySchema } from "@print-automated/validation";

/** `?shopId=` only, same shape as the dashboard queries (dashboard.dto.ts). */
export class ShopPlanQueryDto extends createZodDto(shopDashboardQuerySchema) {}
