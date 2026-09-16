import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { JwtAuthGuard, type RequestWithUser } from "../auth/jwt-auth.guard.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { Roles } from "../auth/roles.decorator.js";
import { ShopScopeGuard } from "../auth/shop-scope.guard.js";
import { ShopScoped } from "../auth/shop-scoped.decorator.js";
import { ListPrintersQueryDto } from "./dto/list-printers-query.dto.js";
import { RegisterPrinterDto } from "./dto/register-printer.dto.js";
import { UpdatePrinterDto } from "./dto/update-printer.dto.js";
import { PrinterShopResolver } from "./printer-shop.resolver.js";
import { PrintersService, type PrinterResponse } from "./printers.service.js";

@Controller("shop/printers")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SHOP_COUNTER, UserRole.SHOP_MANAGER, UserRole.SHOP_OWNER)
export class PrintersController {
  constructor(private readonly printersService: PrintersService) {}

  @Get()
  list(
    @Req() req: RequestWithUser,
    @Query() query: ListPrintersQueryDto,
  ): Promise<PrinterResponse[]> {
    return this.printersService.list(req.user!.id, query.shopId);
  }

  @Post()
  register(@Req() req: RequestWithUser, @Body() dto: RegisterPrinterDto): Promise<PrinterResponse> {
    return this.printersService.register(req.user!.id, dto);
  }

  @Patch(":id")
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", PrinterShopResolver)
  update(@Param("id") id: string, @Body() dto: UpdatePrinterDto): Promise<PrinterResponse> {
    return this.printersService.update(id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ShopScopeGuard)
  @ShopScoped("id", PrinterShopResolver)
  remove(@Param("id") id: string): Promise<void> {
    return this.printersService.remove(id);
  }
}
