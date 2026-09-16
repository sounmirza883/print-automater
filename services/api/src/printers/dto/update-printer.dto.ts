import { createZodDto } from "nestjs-zod";
import { updatePrinterSchema } from "@print-automated/validation";

export class UpdatePrinterDto extends createZodDto(updatePrinterSchema) {}
