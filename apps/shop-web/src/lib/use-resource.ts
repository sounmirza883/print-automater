"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isUnauthenticated, redirectToSignIn } from "@/lib/api";

export interface ResourceState<T> {
  /** The last successful result; kept while a refresh is in flight or fails. */
  data: T | null;
  /** The latest failure, cleared by the next success. `data` may still be set (stale). */
  error: unknown;
  /** First load, nothing to show yet. */
  loading: boolean;
  /** A background re-fetch is running. */
  refreshing: boolean;
  lastUpdated: number | null;
  reload: () => void;
}

interface Options {
  /** Re-fetch every N ms while the tab is visible (the `lib/use-*` polling pattern). */
  intervalMs?: number;
  /** False parks the resource (no fetch) until it turns true. */
  enabled?: boolean;
}

interface Snapshot<T> {
  key: string;
  data: T | null;
  error: unknown;
  refreshing: boolean;
  settled: boolean;
  lastUpdated: number | null;
}

/** Fetch-on-mount + polling with stale-while-revalidate: a failed refresh
 * never blanks a screen that already has numbers on it, it just sets
 * `error` so the page can say "showing data from HH:MM". A 401 that got
 * past the client's own refresh means the session is gone: go to sign-in.
 * `deps` restart the fetch from scratch (another business, a new date
 * range) -- a snapshot taken for different deps is never shown. `load`
 * is read through a ref so it can be an inline closure. */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  options: Options = {},
): ResourceState<T> {
  const { intervalMs, enabled = true } = options;
  const key = JSON.stringify(deps);
  const [snapshot, setSnapshot] = useState<Snapshot<T>>({
    key,
    data: null,
    error: null,
    refreshing: false,
    settled: false,
    lastUpdated: null,
  });
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(async (forKey: string): Promise<void> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSnapshot((previous) =>
      previous.key === forKey
        ? { ...previous, refreshing: true }
        : {
            key: forKey,
            data: null,
            error: null,
            refreshing: true,
            settled: false,
            lastUpdated: null,
          },
    );
    try {
      const data = await loadRef.current(controller.signal);
      if (!controller.signal.aborted) {
        setSnapshot({
          key: forKey,
          data,
          error: null,
          refreshing: false,
          settled: true,
          lastUpdated: Date.now(),
        });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (isUnauthenticated(error)) {
        redirectToSignIn();
        return;
      }
      setSnapshot((previous) => ({ ...previous, error, refreshing: false, settled: true }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void run(key);
    return () => controllerRef.current?.abort();
  }, [key, enabled, run]);

  useEffect(() => {
    if (!enabled || intervalMs === undefined) {
      return;
    }
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void run(key);
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [key, enabled, intervalMs, run]);

  const reload = useCallback(() => void run(key), [key, run]);

  const current = snapshot.key === key ? snapshot : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: enabled && (current === null || (!current.settled && current.data === null)),
    refreshing: current?.refreshing ?? false,
    lastUpdated: current?.lastUpdated ?? null,
    reload,
  };
}
