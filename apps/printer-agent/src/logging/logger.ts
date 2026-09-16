import { join } from "node:path";
import pino from "pino";
import { LOG_DIR } from "../config/paths.js";

/** §9.5's "structured file logging with rotation." `pino-roll` (not a
 * plain file stream) rotates daily and caps total size -- a background
 * agent with no operator watching it must not be able to fill a
 * user's disk over weeks of uptime. Also pretty-prints to stdout when
 * run interactively (`pnpm dev`), same dev-ergonomics precedent as
 * services/api/services/worker's own pino-pretty usage, but never in
 * a packaged build (13.3) where there's no console to read it from. */
export function createLogger(): pino.Logger {
  const isDev = process.env.NODE_ENV !== "production";

  return pino(
    { level: process.env.LOG_LEVEL ?? "info", base: { pid: process.pid } },
    pino.transport({
      targets: [
        {
          target: "pino-roll",
          level: "info",
          options: {
            file: join(LOG_DIR, "agent.log"),
            frequency: "daily",
            size: "10m",
            limit: { count: 14 },
            mkdir: true,
          },
        },
        ...(isDev
          ? [{ target: "pino-pretty", level: "debug" as const, options: { colorize: true } }]
          : []),
      ],
    }),
  );
}
