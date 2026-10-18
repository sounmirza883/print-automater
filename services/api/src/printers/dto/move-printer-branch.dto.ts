import { createZodDto } from "nestjs-zod";
import { movePrinterBranchSchema } from "@print-automated/validation";

export class MovePrinterBranchDto extends createZodDto(movePrinterBranchSchema) {}
