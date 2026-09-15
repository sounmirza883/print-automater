import { createZodDto } from "nestjs-zod";
import { registerSchema } from "@print-automated/validation";

export class RegisterDto extends createZodDto(registerSchema) {}
