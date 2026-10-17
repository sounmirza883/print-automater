import { createZodDto } from "nestjs-zod";
import { updateShopStaffAccessSchema } from "@print-automated/validation";

export class UpdateShopStaffAccessDto extends createZodDto(updateShopStaffAccessSchema) {}
