import { PassThrough } from "node:stream";
import { PinoLoggerService } from "./pino-logger.service.js";

function captureLines(): { stream: PassThrough; lines: () => Record<string, unknown>[] } {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
  return {
    stream,
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("PinoLoggerService", () => {
  it("logs a plain-string message with the Nest-appended context, the dominant call shape in this codebase", () => {
    const { stream, lines } = captureLines();
    const logger = new PinoLoggerService("info", stream);

    logger.log("Order expiration sweep scheduled every 60000ms.", "OrderExpirationScheduler");

    expect(lines()).toEqual([
      expect.objectContaining({
        msg: "Order expiration sweep scheduled every 60000ms.",
        context: "OrderExpirationScheduler",
      }),
    ]);
  });

  it("§103/12.5: merges an object-first message (Pino's own native convention) instead of stringifying it to [object Object] -- payment-reconciliation.processor.ts's own call shape", () => {
    const { stream, lines } = captureLines();
    const logger = new PinoLoggerService("info", stream);

    logger.error(
      {
        paymentId: "pay_123",
        orderId: "ord_456",
        localStatus: "PAID",
        providerOutcome: "FAILED",
      },
      "payment reconciliation divergence detected",
      "PaymentReconciliationProcessor",
    );

    expect(lines()).toEqual([
      expect.objectContaining({
        msg: "payment reconciliation divergence detected",
        context: "PaymentReconciliationProcessor",
        paymentId: "pay_123",
        orderId: "ord_456",
        localStatus: "PAID",
        providerOutcome: "FAILED",
      }),
    ]);
  });

  it("logs a plain-string error with no stack, just a trailing context", () => {
    const { stream, lines } = captureLines();
    const logger = new PinoLoggerService("info", stream);

    logger.error(
      "Payment reconciliation sweep (job 42) failed: boom",
      "PaymentReconciliationProcessor",
    );

    expect(lines()).toEqual([
      expect.objectContaining({
        msg: "Payment reconciliation sweep (job 42) failed: boom",
        context: "PaymentReconciliationProcessor",
      }),
    ]);
    expect(lines()[0]).not.toHaveProperty("err");
  });

  it("routes debug/warn/verbose/fatal through the matching pino level", () => {
    const { stream, lines } = captureLines();
    const logger = new PinoLoggerService("trace", stream);

    logger.warn("warn message", "Ctx");
    logger.debug("debug message", "Ctx");
    logger.verbose("verbose message", "Ctx");
    logger.fatal("fatal message", "Ctx");

    const levels = lines().map((line) => line.level);
    // pino levels: warn=40, debug=20, trace=10 (verbose maps to trace), fatal=60
    expect(levels).toEqual([40, 20, 10, 60]);
  });
});
