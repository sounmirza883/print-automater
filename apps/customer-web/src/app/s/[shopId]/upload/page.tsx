"use client";

import { use, useEffect, useRef, useState, type ReactNode } from "react";
import { ConfigureStep, type WizardStep } from "@/components/qr/configure-step";
import { ConfirmationScreen } from "@/components/qr/confirmation";
import { GuestDetailsStep } from "@/components/qr/details-step";
import {
  BranchChecking,
  BranchClosedScreen,
  BranchGoneScreen,
  OrderingBranchContext,
} from "@/components/qr/ordering-branch";
import { UploadStep } from "@/components/qr/upload-step";
import {
  branchStage,
  fetchPublicBranch,
  orderBranchId,
  parseBranchParam,
  type BranchLookup,
} from "@/lib/public-branch";
import { createPublicOrder } from "@/lib/public-order";

/** 24.1's QR landing page: a guest who scanned a shop's printed QR code
 * lands here with `:shopId` fixed by the URL -- there is no login, no
 * shop picker, and (per the backend's own accepted scope boundary,
 * Task 4) no live price preview: the guest picks print options blind
 * and sees the real total for the first time on the confirmation
 * screen (`components/qr/confirmation.tsx`), from the just-placed
 * order's own `pricingSnapshot`. One page/wizard, not one route per
 * step: there's no account for a half-finished order to resume under.
 * Each step's screen lives in `components/qr/`.
 *
 * Each branch of a business has its own QR code, which adds `?branch=<id>`: the order is placed at
 * that branch. A code without it (printed before branches existed) or with one the API does not
 * know orders from the business's oldest branch, which the server picks. */
export default function QrOrderUploadPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): ReactNode {
  const { shopId } = use(params);
  const { branch } = use(searchParams);
  return <QrOrderWizard shopId={shopId} branchId={parseBranchParam(branch)} />;
}

/** Looks up the branch the code names before showing anything, so a closed branch is told so up
 * front instead of after an upload, and every step can say where the order is going. The lookup
 * only informs: the API still decides whether the order is accepted. */
function QrOrderWizard({
  shopId,
  branchId,
}: {
  shopId: string;
  branchId: string | undefined;
}): ReactNode {
  const [lookup, setLookup] = useState<BranchLookup>(
    branchId === undefined ? { kind: "none" } : { kind: "loading" },
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (branchId === undefined) {
      return;
    }
    let cancelled = false;
    void fetchPublicBranch(shopId, branchId).then((next) => {
      if (!cancelled) {
        setLookup(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [shopId, branchId, attempt]);

  const stage = branchStage(lookup);
  if (stage === "loading") {
    return <BranchChecking />;
  }
  if (stage === "gone") {
    return <BranchGoneScreen />;
  }
  if (lookup.kind === "found" && stage === "closed") {
    return (
      <BranchClosedScreen
        branch={lookup.branch}
        onCheckAgain={() => {
          setLookup({ kind: "loading" });
          setAttempt((count) => count + 1);
        }}
      />
    );
  }
  return (
    <OrderingBranchContext.Provider value={lookup.kind === "found" ? lookup.branch : null}>
      <QrOrderSteps shopId={shopId} orderBranch={orderBranchId(branchId, lookup)} />
    </OrderingBranchContext.Provider>
  );
}

function QrOrderSteps({
  shopId,
  orderBranch,
}: {
  shopId: string;
  /** The branch the order carries; undefined sends none, and the API uses the oldest branch. */
  orderBranch: string | undefined;
}): ReactNode {
  const [step, setStep] = useState<WizardStep>({ name: "details" });
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  // Minted once per mount of this wizard, reused across a retry -- a
  // double-tap on "Place order" or a retry after a transient network
  // error must not place two orders (§92).
  const idempotencyKey = useRef(crypto.randomUUID());

  if (step.name === "details") {
    return (
      <GuestDetailsStep
        onContinue={(name, phone) => {
          setGuestName(name);
          setGuestPhone(phone);
          setStep({ name: "upload" });
        }}
      />
    );
  }

  if (step.name === "upload") {
    return (
      <UploadStep
        shopId={shopId}
        onReady={(documentId, filename, pageCount) =>
          setStep({ name: "configure", documentId, filename, pageCount })
        }
      />
    );
  }

  if (step.name === "confirmed") {
    return (
      <ConfirmationScreen
        order={step.order}
        onOrderAgain={() => {
          // The guest's name and phone stay, so the next order starts at the
          // upload. A fresh key: reusing the old one would make the backend
          // replay the order just placed instead of creating a new one.
          idempotencyKey.current = crypto.randomUUID();
          setStep({ name: "upload" });
        }}
      />
    );
  }

  return (
    <ConfigureStep
      step={step}
      onSubmit={(printConfiguration) => {
        const { documentId, filename, pageCount } = step;
        setStep({ name: "submitting", documentId, filename, pageCount });
        createPublicOrder(
          shopId,
          guestName,
          guestPhone,
          documentId,
          printConfiguration,
          idempotencyKey.current,
          fetch,
          orderBranch,
        )
          .then((order) => setStep({ name: "confirmed", order }))
          .catch((error: unknown) => {
            setStep({
              name: "submit-error",
              documentId,
              filename,
              pageCount,
              message: error instanceof Error ? error.message : "Could not place this order.",
            });
          });
      }}
    />
  );
}
