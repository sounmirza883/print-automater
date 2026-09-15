import {
  HttpStatus,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { from, of, type Observable } from "rxjs";
import { catchError, mergeMap } from "rxjs/operators";
import { PrismaService } from "@print-automated/backend-shared";
import { AppException } from "../common/errors/app-exception.js";
import { stableStringify } from "./stable-stringify.js";

/** A status value no real HTTP response ever has -- marks a claimed-
 * but-not-yet-completed row so a concurrent replay can tell "still
 * running" apart from "finished, here's the answer" without a second
 * column. */
const PENDING_STATUS = 0;

type ClaimResult =
  | { outcome: "claimed" }
  | { outcome: "mismatch" }
  | { outcome: "pending" }
  | { outcome: "replay"; status: number; body: unknown };

/** §92 `Idempotency-Key` header support. Applied per-route via
 * `@UseInterceptors(IdempotencyInterceptor)` -- a request with no
 * `Idempotency-Key` header simply isn't guarded (most callers, most of
 * the time); one that supplies the header gets the full guarantee.
 *
 * The claim happens *before* the real handler ever runs (an atomic
 * `INSERT` that either succeeds -- this caller now owns the key -- or
 * fails on the (key, scope) unique constraint from 5.1's migration,
 * meaning someone already does): that ordering is what actually
 * prevents the guarded operation from running twice, not just what
 * makes a *response* replay-able after the fact. A concurrent second
 * caller that loses the race while the first is still in flight gets a
 * 409 IDEMPOTENCY_KEY_IN_PROGRESS rather than either blocking or
 * (worse) being allowed through to run the handler a second time. A
 * handler that throws has its claim deleted, not completed with an
 * error response cached -- a genuine failure must remain retryable
 * with the same key, not get permanently stuck replaying a 500. */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request>();
    const rawKey = request.headers["idempotency-key"];
    const key = typeof rawKey === "string" ? rawKey : undefined;
    if (key === undefined || key.length === 0) {
      return next.handle();
    }

    const scope = `${request.method} ${request.route?.path ?? request.path}`;
    const requestHash = stableStringify(request.body);

    const claim = await this.claim(key, scope, requestHash);

    if (claim.outcome === "mismatch") {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "IDEMPOTENCY_KEY_REUSED",
        "This idempotency key was already used with a different request.",
        false,
      );
    }
    if (claim.outcome === "pending") {
      throw new AppException(
        HttpStatus.CONFLICT,
        "IDEMPOTENCY_KEY_IN_PROGRESS",
        "A request with this idempotency key is still being processed.",
        true,
      );
    }
    if (claim.outcome === "replay") {
      context.switchToHttp().getResponse<Response>().status(claim.status);
      return of(claim.body);
    }

    return next.handle().pipe(
      mergeMap((body: unknown) =>
        from(
          this.prisma.idempotencyKey.update({
            where: { key_scope: { key, scope } },
            data: {
              responseStatus: context.switchToHttp().getResponse<Response>().statusCode,
              responseBody: (body ?? null) as Prisma.InputJsonValue,
            },
          }),
        ).pipe(mergeMap(() => of(body))),
      ),
      catchError((error: unknown) =>
        from(
          (async () => {
            await this.prisma.idempotencyKey
              .delete({ where: { key_scope: { key, scope } } })
              .catch(() => undefined);
            throw error;
          })(),
        ),
      ),
    );
  }

  private async claim(key: string, scope: string, requestHash: string): Promise<ClaimResult> {
    try {
      await this.prisma.idempotencyKey.create({
        data: { key, scope, requestHash, responseStatus: PENDING_STATUS, responseBody: {} },
      });
      return { outcome: "claimed" };
    } catch {
      // Deliberately not narrowed to a specific Prisma error code (e.g.
      // P2002) -- any create() failure here falls through to "go see
      // what's actually there" instead. If there's truly nothing (a
      // different, genuine failure), findUniqueOrThrow itself throws,
      // and that -- correctly -- still surfaces as a real error rather
      // than being misread as a successful claim.
      const existing = await this.prisma.idempotencyKey.findUniqueOrThrow({
        where: { key_scope: { key, scope } },
      });
      if (existing.requestHash !== requestHash) {
        return { outcome: "mismatch" };
      }
      if (existing.responseStatus === PENDING_STATUS) {
        return { outcome: "pending" };
      }
      return { outcome: "replay", status: existing.responseStatus, body: existing.responseBody };
    }
  }
}
