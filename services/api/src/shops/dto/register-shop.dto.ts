import { createZodDto } from "nestjs-zod";
import { registerShopSchema } from "@print-automated/validation";

export class RegisterShopDto extends createZodDto(registerShopSchema) {}
