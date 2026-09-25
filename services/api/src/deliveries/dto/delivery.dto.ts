import { createZodDto } from "nestjs-zod";
import { deliveryStatusSchema, saveDeliverySchema } from "@print-automated/validation";

export class SaveDeliveryDto extends createZodDto(saveDeliverySchema) {}
export class DeliveryStatusDto extends createZodDto(deliveryStatusSchema) {}
