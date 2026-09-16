import { createZodDto } from "nestjs-zod";
import { heartbeatSchema } from "@print-automated/validation";

export class HeartbeatDto extends createZodDto(heartbeatSchema) {}
