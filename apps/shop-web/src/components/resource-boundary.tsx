"use client";

import type { ReactNode } from "react";
import { useSession } from "@/components/session-provider";
import { ErrorState, ForbiddenState, LoadingGrid, StaleBanner } from "@/components/ui";
import type { ResourceState } from "@/lib/use-resource";
import type { Permission } from "@print-automated/types";

/** Loading -> error -> data, once, for every screen: skeleton on first
 * load, the error/403 state when there is nothing to show, and the
 * "live updates paused, showing older data" banner when a background
 * refresh fails on a screen that already has numbers. */
export function ResourceBoundary<T>({
  state,
  what,
  children,
}: {
  state: ResourceState<T>;
  what: string;
  children: (data: T) => ReactNode;
}): ReactNode {
  if (state.data === null) {
    return state.error !== null ? (
      <ErrorState error={state.error} onRetry={state.reload} what={what} />
    ) : (
      <LoadingGrid label={`Loading ${what}`} />
    );
  }
  return (
    <>
      <StaleBanner error={state.error} lastUpdated={state.lastUpdated} onRetry={state.reload} />
      {children(state.data)}
    </>
  );
}

/** Renders `children` only when the person's role at the selected
 * business holds `permission`; otherwise the "no access" state. This is
 * a courtesy: the API answers 403 to the same request regardless. */
export function RequirePermission({
  permission,
  what,
  children,
}: {
  permission: Permission;
  what: string;
  children: ReactNode;
}): ReactNode {
  const { can, business } = useSession();
  if (business === null) {
    return null;
  }
  return can(permission) ? children : <ForbiddenState what={what} />;
}
