import { createZodDto } from "nestjs-zod";
import { authenticateSchema } from "@print-automated/validation";

export class AuthenticateDto extends createZodDto(authenticateSchema) {}
