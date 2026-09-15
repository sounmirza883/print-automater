import { createZodDto } from "nestjs-zod";
import { loginSchema } from "@print-automated/validation";

export class LoginDto extends createZodDto(loginSchema) {}
