import { createZodDto } from "nestjs-zod";
import { listShopStaffQuerySchema } from "@print-automated/validation";

export class ListShopStaffQueryDto extends createZodDto(listShopStaffQuerySchema) {}
