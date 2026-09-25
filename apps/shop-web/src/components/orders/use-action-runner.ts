"use client";

import { useMemo, useState } from "react";
import { interpretActionFailure } from "@/lib/error-copy";

export type ActionOutcome = "ok" | "failed" | "late-print" | "busy";

interface RunnerSinks {
  onChanged: () => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
}

/** The single-flight core, separate from React so it can be tested: only
 * ONE request at a time (the lock is a plain flag, so a second click in
 * the same tick is ignored, unlike state which would not have updated
 * yet); a failure becomes a precise message from the API's `error_code`;
 * the screen reloads when the failure means its data is stale; and
 * LATE_PRINT_ACK_REQUIRED is its own outcome so the caller opens the
 * confirmation dialog rather than showing an error. */
export function createActionRunner(
  sinks: RunnerSinks,
): (action: () => Promise<unknown>) => Promise<ActionOutcome> {
  let inFlight = false;
  return async (action) => {
    if (inFlight) {
      return "busy";
    }
    inFlight = true;
    sinks.setBusy(true);
    sinks.setError(null);
    try {
      await action();
      sinks.onChanged();
      return "ok";
    } catch (failure) {
      const result = interpretActionFailure(failure);
      if (result.kind === "confirm-late-print") {
        return "late-print";
      }
      sinks.setError(result.text);
      if (result.refresh) {
        sinks.onChanged();
      }
      return "failed";
    } finally {
      inFlight = false;
      sinks.setBusy(false);
    }
  };
}

/** React binding: `busy` is true for the whole request so every button
 * can disable, `error` is the last failure's wording. */
export function useActionRunner(onChanged: () => void): {
  busy: boolean;
  error: string | null;
  clearError: () => void;
  run: (action: () => Promise<unknown>) => Promise<ActionOutcome>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The runner (and its lock) must survive re-renders; only a new
  // `onChanged` (a new resource key) makes a new one.
  const run = useMemo(() => createActionRunner({ onChanged, setBusy, setError }), [onChanged]);
  return { busy, error, clearError: () => setError(null), run };
}
