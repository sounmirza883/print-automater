import { createZodDto } from "nestjs-zod";
import { updateUserStatusSchema } from "@print-automated/validation";

export class UpdateUserStatusDto extends createZodDto(updateUserStatusSchema) {}
