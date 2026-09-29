import { createZodDto } from "nestjs-zod";
import { createPublicOrderSchema } from "@print-automated/validation";

export class CreatePublicOrderDto extends createZodDto(createPublicOrderSchema) {}
