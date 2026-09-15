import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { UserRole } from "@prisma/client";
import { ROLES_KEY } from "./roles.decorator.js";
import type { RequestWithUser } from "./jwt-auth.guard.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // no @Roles() on this route -- nothing to enforce
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!request.user || !requiredRoles.includes(request.user.role)) {
      throw new ForbiddenException("Insufficient role for this resource.");
    }

    return true;
  }
}
