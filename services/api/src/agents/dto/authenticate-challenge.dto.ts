import { createZodDto } from "nestjs-zod";
import { authenticateChallengeSchema } from "@print-automated/validation";

export class AuthenticateChallengeDto extends createZodDto(authenticateChallengeSchema) {}
