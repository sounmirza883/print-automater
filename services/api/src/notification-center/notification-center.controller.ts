import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { NotificationItem, Page } from "@print-automated/types";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import {
  ListNotificationsQueryDto,
  NotificationFilterQueryDto,
} from "./dto/list-notifications-query.dto.js";
import { NotificationCenterService } from "./notification-center.service.js";

/** 23.7 (PRD 111): the caller's own notification centre. Any signed-in user (customer or
 * staff) -- there is no shop or permission parameter to spoof: every read and write is
 * keyed by the token's user id. */
@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationCenterController {
  constructor(private readonly center: NotificationCenterService) {}

  @Get()
  list(
    @Req() req: RequestWithUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<Page<NotificationItem>> {
    return this.center.list(req.user!.id, query);
  }

  @Get("unread-count")
  unreadCount(
    @Req() req: RequestWithUser,
    @Query() query: NotificationFilterQueryDto,
  ): Promise<{ count: number }> {
    return this.center.unreadCount(req.user!.id, query);
  }

  @Post("read-all")
  @HttpCode(HttpStatus.OK)
  readAll(
    @Req() req: RequestWithUser,
    @Query() query: NotificationFilterQueryDto,
  ): Promise<{ updated: number }> {
    return this.center.markAllRead(req.user!.id, query);
  }

  @Post(":id/read")
  @HttpCode(HttpStatus.OK)
  read(@Req() req: RequestWithUser, @Param("id") id: string): Promise<NotificationItem> {
    return this.center.markRead(req.user!.id, id);
  }
}
