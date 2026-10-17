import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { ModuleRef, Reflector } from "@nestjs/core";
import { Permission } from "@print-automated/types";
import { Observable, from, map, switchMap } from "rxjs";
import { resolveEffectiveAccess } from "../auth/resolve-effective-role.js";
import { ShopMembershipService } from "../auth/shop-membership.service.js";

/** True for a delivery record (the shape DeliveriesService returns). */
function isDelivery(value: object): boolean {
  return "address" in value && "trackingNumber" in value && "feeMinor" in value;
}

/** 23.13: the customer contact block of an order detail. */
function isCustomerContact(value: object): boolean {
  const kind = (value as { kind?: unknown }).kind;
  return (
    (kind === "WALK_IN" || kind === "ACCOUNT") &&
    "name" in value &&
    "phone" in value &&
    "email" in value
  );
}

/** Replaces the address of every delivery record found in `body` (a single
 * order, a grouped list, or a delivery itself) with null and flags it; the same
 * roles also lose an order's customer phone/email (23.13). */
export function redactDeliveryAddresses(body: unknown): unknown {
  if (Array.isArray(body)) {
    return body.map(redactDeliveryAddresses);
  }
  if (body === null || typeof body !== "object" || body instanceof Date) {
    return body;
  }
  if (isDelivery(body)) {
    return { ...body, address: null, addressRedacted: true };
  }
  if (isCustomerContact(body)) {
    return { ...body, phone: null, email: null, contactRedacted: true };
  }
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, redactDeliveryAddresses(value)]),
  );
}

/** 21.8 (data minimisation). The delivery address is personal data that only
 * roles able to manage a delivery need. For every other role (operator, printer
 * manager) it is omitted from the order responses and from GET delivery, decided
 * from the SAME effective access (role defaults plus the person's own overrides) the
 * permission guard uses, never a role branch. */
@Injectable()
export class DeliveryRedactionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
    private readonly shopMembership: ShopMembershipService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(
      resolveEffectiveAccess(context, this.reflector, this.moduleRef, this.shopMembership),
    ).pipe(
      switchMap((access) => {
        const allowed = access?.permissions.includes(Permission.MANAGE_DELIVERY) ?? false;
        const stream = next.handle();
        return allowed ? stream : stream.pipe(map(redactDeliveryAddresses));
      }),
    );
  }
}
