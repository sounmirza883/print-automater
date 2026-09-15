import { Module } from "@nestjs/common";
import { PasswordService } from "./password.service.js";
import { TokenService } from "./token.service.js";

@Module({
  providers: [PasswordService, TokenService],
  exports: [PasswordService, TokenService],
})
export class AuthModule {}
