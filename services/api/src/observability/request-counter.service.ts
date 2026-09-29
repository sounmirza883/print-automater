import { Injectable } from "@nestjs/common";

/** The rolling window "requests per minute" is measured over. */
export const TRAFFIC_WINDOW_MS = 60_000;

/** 23.7 (Workstream C): a minimal, in-process request counter for the admin
 * dashboard's "traffic" tile. Deliberately in-memory and per-process, NOT
 * Redis-backed: figures reset on restart and are scoped to whichever API
 * instance served the request -- there is no cross-instance aggregation.
 * This is a lightweight ops signal, not a metrics stack (no Prometheus
 * exists in this repo and this counter does not attempt to become one); a
 * real multi-instance deployment would need a shared store to add these up,
 * which is explicitly out of scope here.
 *
 * `now` is an optional explicit timestamp (defaulting to `Date.now()`) on
 * every method rather than an injected clock dependency, so the class stays
 * a plain zero-arg-constructor Nest provider while remaining trivially
 * unit-testable with fixed timestamps. */
@Injectable()
export class RequestCounterService {
  private readonly timestamps: number[] = [];
  private totalSinceStart = 0;

  /** Call once per request. */
  record(now: number = Date.now()): void {
    this.totalSinceStart += 1;
    this.timestamps.push(now);
    this.prune(now);
  }

  getStats(now: number = Date.now()): { totalSinceStart: number; requestsPerMinute: number } {
    this.prune(now);
    return { totalSinceStart: this.totalSinceStart, requestsPerMinute: this.timestamps.length };
  }

  private prune(now: number): void {
    const cutoff = now - TRAFFIC_WINDOW_MS;
    while (this.timestamps.length > 0 && (this.timestamps[0] as number) < cutoff) {
      this.timestamps.shift();
    }
  }
}
