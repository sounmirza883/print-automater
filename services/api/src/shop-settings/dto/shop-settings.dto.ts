import { createZodDto } from "nestjs-zod";
import { getShopSettingsQuerySchema, updateShopSettingsSchema } from "@print-automated/validation";

export class GetShopSettingsQueryDto extends createZodDto(getShopSettingsQuerySchema) {}
export class UpdateShopSettingsDto extends createZodDto(updateShopSettingsSchema) {}
