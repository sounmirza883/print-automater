"use client";

import { useEffect, useRef } from "react";

/** 27.3: opens `GET /v1/shop/dashboard/live` (an SSE stream, proxied through
 * `/api/v1/...`) and calls `onEvent` for every ping while it's open. The
 * native `EventSource` retries automatically on a dropped connection (the
 * browser's own backoff, not hand-rolled here); the caller's EXISTING
 * polling interval is left running the whole time as an unconditional
 * fallback, so a flaky connection degrades to today's behavior rather than
 * going silent. `onEvent` is read through a ref, the same pattern
 * `useResource`'s own `load` uses, so an inline closure never re-opens the
 * connection on every render. */
export function useLiveDashboard(shopId: string | undefined, onEvent: () => void): void {
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (shopId === undefined || shopId === "") {
      return;
    }
    const source = new EventSource(
      `/api/v1/shop/dashboard/live?shopId=${encodeURIComponent(shopId)}`,
    );
    source.onmessage = () => onEventRef.current();
    return () => source.close();
  }, [shopId]);
}
