import { createZodDto } from "nestjs-zod";
import {
  createBranchSchema,
  listBranchesQuerySchema,
  setBranchOpenStateSchema,
  updateBranchSchema,
} from "@print-automated/validation";

export class ListBranchesQueryDto extends createZodDto(listBranchesQuerySchema) {}
export class CreateBranchDto extends createZodDto(createBranchSchema) {}
export class UpdateBranchDto extends createZodDto(updateBranchSchema) {}
export class SetBranchOpenStateDto extends createZodDto(setBranchOpenStateSchema) {}
