import { createZodDto } from "nestjs-zod";
import {
  listNotificationsQuerySchema,
  notificationFilterSchema,
} from "@print-automated/validation";

export class ListNotificationsQueryDto extends createZodDto(listNotificationsQuerySchema) {}
export class NotificationFilterQueryDto extends createZodDto(notificationFilterSchema) {}
