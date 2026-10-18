"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Button, Card, SiteFrame } from "@/components/ui";
import type { PublicBranch } from "@/lib/public-branch";

/** The branch whose QR code was scanned, once the API has confirmed it. Null for a code with no
 * branch (printed before branches existed) and while it is not known, so nothing is shown then. */
export const OrderingBranchContext = createContext<PublicBranch | null>(null);

/** "Ordering from Gulberg": above the steps, so a guest can see which branch their order goes to. */
export function OrderingFrom(): ReactNode {
  const branch = useContext(OrderingBranchContext);
  if (branch === null) {
    return null;
  }
  return (
    <p className="mb-4 text-sm text-muted">
      Ordering from <strong className="font-semibold text-ink">{branch.name}</strong>
      {branch.city !== null && ` · ${branch.city}`}
    </p>
  );
}

/** Asking the API about the branch; brief, and only for a code that names one. */
export function BranchChecking(): ReactNode {
  return (
    <SiteFrame width="narrow">
      <p role="status" className="text-sm text-muted">
        Checking this branch…
      </p>
    </SiteFrame>
  );
}

/** A closed branch takes no orders, so the guest is told so before uploading anything. They can
 * check again without scanning the code once more. */
export function BranchClosedScreen({
  branch,
  onCheckAgain,
}: {
  branch: PublicBranch;
  onCheckAgain: () => void;
}): ReactNode {
  return (
    <SiteFrame width="narrow">
      <div className="grid gap-5">
        <div role="status" className="grid gap-2">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">
            {branch.name} is closed right now
          </h1>
          <p className="text-sm text-muted">
            This branch is not taking orders at the moment. Please try again when it is open, or ask
            at the counter.
          </p>
        </div>
        {branch.address !== "" && (
          <Card className="grid gap-1 py-3 text-sm">
            <p className="font-medium">{branch.name}</p>
            <p className="text-muted">
              {branch.address}
              {branch.city !== null && `, ${branch.city}`}
            </p>
          </Card>
        )}
        <Button block onClick={onCheckAgain}>
          Check again
        </Button>
      </div>
    </SiteFrame>
  );
}
