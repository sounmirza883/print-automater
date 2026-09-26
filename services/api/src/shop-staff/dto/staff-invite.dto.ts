import { createZodDto } from "nestjs-zod";
import {
  acceptStaffInviteSchema,
  listStaffInvitesQuerySchema,
  staffDirectoryQuerySchema,
} from "@print-automated/validation";

export class AcceptStaffInviteDto extends createZodDto(acceptStaffInviteSchema) {}
export class ListStaffInvitesQueryDto extends createZodDto(listStaffInvitesQuerySchema) {}
export class StaffDirectoryQueryDto extends createZodDto(staffDirectoryQuerySchema) {}
