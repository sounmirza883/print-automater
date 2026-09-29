import { createZodDto } from "nestjs-zod";
import { updateBusinessStatusSchema } from "@print-automated/validation";

export class UpdateBusinessStatusDto extends createZodDto(updateBusinessStatusSchema) {}
