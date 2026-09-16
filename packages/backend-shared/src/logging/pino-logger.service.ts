import type { LoggerService } from "@nestjs/common";
import pino from "pino";

/** §103/12.5: "structured logs to CloudWatch." Every BullMQ scheduler/
 * processor in services/worker (and payment-reconciliation in
 * services/api) constructs its own `new Logger(ClassName)` from
 * `@nestjs/common` -- Nest's own default, which prints a colored,
 * human-readable line, not JSON. Only services/api's own HTTP
 * request/response logging (bootstrap.ts's pino-http middleware, 1.8)
 * was ever actually structured; every one of those `Logger` calls
 * (order expired, printer went offline, print job timed out, document
 * deleted, payment reconciliation divergence detected, ...) -- exactly
 * the operational events §103's own metrics/alerts need to query --
 * was not.
 *
 * Passed to `NestFactory.create()`/`createApplicationContext()`'s own
 * `logger` option (not `app.useLogger()` called afterward), so even
 * Nest's own internal startup logs (InstanceLoader, RoutesResolver,
 * ...) go through it too, not just this application's own log calls.
 * Reuses `pino` directly (already a dependency of both api and worker)
 * rather than adding the separate `nestjs-pino` integration package,
 * matching bootstrap.ts's own established "use pino directly" choice.
 *
 * Nest's own `Logger` instance methods always append the bound
 * `context` (e.g. the class name passed to `new Logger("MyClass")`) as
 * the LAST element of `optionalParams` (confirmed by reading
 * @nestjs/common's own logger.service.js) -- true regardless of call
 * shape below, so it's always popped off first.
 *
 * Two calling conventions actually occur in this codebase: (a) the
 * dominant one, a plain string message with no other params, e.g.
 * `logger.log(\`Order expiration sweep scheduled...\`)`; (b) exactly one
 * outlier, payment-reconciliation.processor.ts's
 * `logger.error({ paymentId, ... }, "payment reconciliation divergence
 * detected")` -- Pino's OWN native "mergeObject, then message"
 * convention, not Nest's documented shape. A naive `String(message)`
 * would stringify that object into "[object Object]" and lose the real
 * message. Detecting a non-string `message` and treating it as Pino's
 * mergeObject covers that outlier without over-building for shapes
 * nothing here produces. */
export class PinoLoggerService implements LoggerService {
  private readonly pino: pino.Logger;

  /** `destination` is test-only -- production callers (services/api,
   * services/worker `main.ts`) never pass it, so `pino({ level })`
   * writes to its normal stdout destination there; tests inject a
   * captured stream so they can assert on the actual emitted JSON
   * instead of re-testing pino itself. */
  constructor(level: string = "info", destination?: NodeJS.WritableStream) {
    this.pino = destination ? pino({ level }, destination) : pino({ level });
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    const [mergeObject, msg] = buildLogArgs(message, optionalParams);
    this.pino.info(mergeObject, msg);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    const [mergeObject, msg] = buildLogArgs(message, optionalParams);
    this.pino.error(mergeObject, msg);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    const [mergeObject, msg] = buildLogArgs(message, optionalParams);
    this.pino.warn(mergeObject, msg);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    const [mergeObject, msg] = buildLogArgs(message, optionalParams);
    this.pino.debug(mergeObject, msg);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    const [mergeObject, msg] = buildLogArgs(message, optionalParams);
    this.pino.trace(mergeObject, msg);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    const [mergeObject, msg] = buildLogArgs(message, optionalParams);
    this.pino.fatal(mergeObject, msg);
  }
}

function buildLogArgs(
  message: unknown,
  optionalParams: unknown[],
): [Record<string, unknown>, string] {
  const params = [...optionalParams];
  // Nest always appends the bound `context` as the LAST optionalParam
  // when the Logger instance was constructed with one -- true for
  // every call shape in this codebase.
  const context =
    typeof params[params.length - 1] === "string" ? (params.pop() as string) : undefined;

  if (message !== null && typeof message === "object" && !Array.isArray(message)) {
    // Pino-native convention: logger.error({ ...fields }, "human message").
    // After popping context above, the remaining first param (if a
    // string) is the real message text.
    const msg = typeof params[0] === "string" ? params[0] : "";
    return [{ context, ...(message as Record<string, unknown>) }, msg];
  }

  // Nest's own error(message, stack?, context?) shape -- a stack trace
  // string, when present, is whatever's left after popping context.
  const err = typeof params[0] === "string" ? params[0] : undefined;
  return [{ context, ...(err !== undefined ? { err } : {}) }, String(message)];
}
