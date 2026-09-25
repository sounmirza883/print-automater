import { createZodDto } from "nestjs-zod";
import {
  operatorDashboardQuerySchema,
  ownerDashboardQuerySchema,
  shopDashboardQuerySchema,
} from "@print-automated/validation";

export class OwnerDashboardQueryDto extends createZodDto(ownerDashboardQuerySchema) {}
export class OperatorDashboardQueryDto extends createZodDto(operatorDashboardQuerySchema) {}
export class ShopDashboardQueryDto extends createZodDto(shopDashboardQuerySchema) {}
