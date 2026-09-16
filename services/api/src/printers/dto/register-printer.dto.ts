import { createZodDto } from "nestjs-zod";
import { registerPrinterSchema } from "@print-automated/validation";

export class RegisterPrinterDto extends createZodDto(registerPrinterSchema) {}
