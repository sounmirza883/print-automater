"use client";

import { use, useRef, useState, type ReactNode } from "react";
import { ConfigureStep, type WizardStep } from "@/components/qr/configure-step";
import { ConfirmationScreen } from "@/components/qr/confirmation";
import { GuestDetailsStep } from "@/components/qr/details-step";
import { UploadStep } from "@/components/qr/upload-step";
import { createPublicOrder } from "@/lib/public-order";

/** 24.1's QR landing page: a guest who scanned a shop's printed QR code
 * lands here with `:shopId` fixed by the URL -- there is no login, no
 * shop picker, and (per the backend's own accepted scope boundary,
 * Task 4) no live price preview: the guest picks print options blind
 * and sees the real total for the first time on the confirmation
 * screen (`components/qr/confirmation.tsx`), from the just-placed
 * order's own `pricingSnapshot`. One page/wizard, not one route per
 * step: there's no account for a half-finished order to resume under.
 * Each step's screen lives in `components/qr/`. */
export default function QrOrderUploadPage({
  params,
}: {
  params: Promise<{ shopId: string }>;
}): ReactNode {
  const { shopId } = use(params);
  return <QrOrderWizard shopId={shopId} />;
}

function QrOrderWizard({ shopId }: { shopId: string }): ReactNode {
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
