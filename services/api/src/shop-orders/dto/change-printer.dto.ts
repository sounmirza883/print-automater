import { createZodDto } from "nestjs-zod";
import { changePrinterSchema } from "@print-automated/validation";

export class ChangePrinterDto extends createZodDto(changePrinterSchema) {}
