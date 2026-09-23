import { createZodDto } from "nestjs-zod";
import { listProductsQuerySchema } from "@print-automated/validation";

export class ListProductsQueryDto extends createZodDto(listProductsQuerySchema) {}
