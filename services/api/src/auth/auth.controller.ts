import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthService, type AuthResult } from "./auth.service.js";
import { RegisterDto } from "./dto/register.dto.js";
import { LoginDto } from "./dto/login.dto.js";
import { RefreshDto } from "./dto/refresh.dto.js";
import { RecoveryDto } from "./dto/recovery.dto.js";
import { RateLimitGuard } from "../rate-limit/rate-limit.guard.js";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";

const MINUTE_MS = 60_000;

function bodyEmail(request: Request): string {
  const email = (request.body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" ? email.toLowerCase() : "unknown";
}

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 3, windowMs: 60 * MINUTE_MS, keyGenerator: (req) => req.ip ?? "unknown" })
  register(@Body() dto: RegisterDto): Promise<AuthResult> {
    return this.authService.register(dto);
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({
    limit: 5,
    windowMs: 15 * MINUTE_MS,
    keyGenerator: (req) => `${req.ip ?? "unknown"}:${bodyEmail(req)}`,
  })
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.authService.login(dto);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto): Promise<Omit<AuthResult, "user">> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  @Post("recovery")
  @HttpCode(HttpStatus.NO_CONTENT)
  async recovery(@Body() dto: RecoveryDto): Promise<void> {
    await this.authService.requestPasswordRecovery(dto.email);
  }
}
