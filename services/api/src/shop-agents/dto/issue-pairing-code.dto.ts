import { createZodDto } from "nestjs-zod";
import { issuePairingCodeSchema } from "@print-automated/validation";

export class IssuePairingCodeDto extends createZodDto(issuePairingCodeSchema) {}
