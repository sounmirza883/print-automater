import { createZodDto } from "nestjs-zod";
import { addShopStaffSchema } from "@print-automated/validation";

export class AddShopStaffDto extends createZodDto(addShopStaffSchema) {}
