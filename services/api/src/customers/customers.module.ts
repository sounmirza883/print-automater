import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CustomerShopResolver } from "./customer-shop.resolver.js";
import { CustomersController } from "./customers.controller.js";
import { CustomersService } from "./customers.service.js";

@Module({
  imports: [AuthModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerShopResolver],
  exports: [CustomersService],
})
export class CustomersModule {}
