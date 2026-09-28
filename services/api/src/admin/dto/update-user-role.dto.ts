import { createZodDto } from "nestjs-zod";
import { updateUserRoleSchema } from "@print-automated/validation";

export class UpdateUserRoleDto extends createZodDto(updateUserRoleSchema) {}
