import { createZodDto } from "nestjs-zod";
import { changeShopStaffRoleSchema } from "@print-automated/validation";

export class ChangeShopStaffRoleDto extends createZodDto(changeShopStaffRoleSchema) {}
