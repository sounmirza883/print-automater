import { createZodDto } from "nestjs-zod";
import { registerAgentSchema } from "@print-automated/validation";

export class RegisterAgentDto extends createZodDto(registerAgentSchema) {}
