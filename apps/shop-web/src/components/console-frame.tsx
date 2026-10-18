"use client";

import type { ReactNode } from "react";
import { ConsoleShell } from "@/components/console-shell";
import { SessionProvider, useSession } from "@/components/session-provider";
import { Button, EmptyState, ErrorState, LoadingGrid, Skeleton } from "@/components/ui";

function SessionLoading(): ReactNode {
  return (
    <div role="status" aria-busy="true" className="grid min-h-screen place-items-center">
      <span className="sr-only">Loading your businesses…</span>
      <div className="grid w-72 gap-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}

function SessionFailed({ retry, error }: { retry: () => void; error: unknown }): ReactNode {
  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-6">
      <ErrorState error={error} onRetry={retry} what="your account" />
    </main>
  );
}

/** A staff account with no active business membership (an owner whose
 * membership was removed, or a fresh account nobody has added yet). */
function NoBusiness({ children }: { children: ReactNode }): ReactNode {
  const { memberships, isAdmin, user } = useSession();
  if (memberships.length > 0 || isAdmin) {
    return children;
  }
  return (
    <EmptyState
      title="You are not part of any business yet"
      action={
        <Button
          onClick={() => {
            void fetch("/api/auth/logout", { method: "POST" }).finally(() => {
              window.location.assign("/login");
            });
          }}
        >
          Sign out
        </Button>
      }
    >
      {user.email} is not an active member of any business. Ask a business owner or manager to add
      you, then sign in again.
    </EmptyState>
  );
}

/** A screen fetches with the selected branch, so it waits until the business's branches are known:
 * otherwise someone who narrowed to one branch would see everything load first, then again. The
 * shell stays up meanwhile, and the wait is brief (and only on opening or switching business). */
function WaitForBranches({ children }: { children: ReactNode }): ReactNode {
  const { branchesReady } = useSession();
  return branchesReady ? children : <LoadingGrid label="Loading your branches" />;
}

/** Session loading -> shell -> screen. Everything under `(console)`
 * renders inside this, so a screen can call `useSession()` and rely on
 * the person, their businesses and their role being known. */
export function ConsoleFrame({
  children,
  topBarExtras,
}: {
  children: ReactNode;
  topBarExtras?: ReactNode;
}): ReactNode {
  return (
    <SessionProvider
      fallback={<SessionLoading />}
      errorFallback={(retry, error) => <SessionFailed retry={retry} error={error} />}
    >
      <ConsoleShell topBarExtras={topBarExtras}>
        <NoBusiness>
          <WaitForBranches>{children}</WaitForBranches>
        </NoBusiness>
      </ConsoleShell>
    </SessionProvider>
  );
}
