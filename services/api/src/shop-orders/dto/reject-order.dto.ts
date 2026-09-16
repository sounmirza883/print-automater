import { createZodDto } from "nestjs-zod";
import { rejectOrderSchema } from "@print-automated/validation";

export class RejectOrderDto extends createZodDto(rejectOrderSchema) {}
