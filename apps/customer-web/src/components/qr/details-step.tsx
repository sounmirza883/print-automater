"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { createPublicOrderSchema } from "@print-automated/validation";
import { Button, Field, INPUT_LG, Notice, SiteFrame } from "@/components/ui";
import { StepIndicator } from "@/components/qr/step-indicator";

/** Step 1: name + phone, no account. Validated with the exact same
 * `createPublicOrderSchema` (`@print-automated/validation`) the
 * backend runs against these two fields -- not a second, hand-rolled
 * copy of the phone-shape rule that could quietly drift from it, the
 * same "one rule, shared" reasoning `page-selection.ts`'s own
 * `validatePageSelection` already follows for page ranges. A rejection
 * here is worded identically to a server-side one (e.g. "Enter a phone
 * number of 7 to 15 digits."), so it's never a surprise later. */
export function GuestDetailsStep({
  onContinue,
}: {
  onContinue: (name: string, phone: string) => void;
}): ReactNode {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = createPublicOrderSchema
      .pick({ name: true, phone: true })
      .safeParse({ name, phone });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Check your details and try again.");
      return;
    }
    setError(null);
    onContinue(result.data.name, result.data.phone);
  }

  return (
    <SiteFrame width="narrow">
      <StepIndicator current={1} />

      <div className="mb-6 grid gap-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Print with this shop</h1>
        <p className="text-sm text-muted">
          No account needed. Just your name and phone number, so the shop can reach you about your
          order.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-4">
        <Field label="Your name">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={INPUT_LG}
            autoComplete="name"
            required
          />
        </Field>
        <Field label="Phone number">
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={INPUT_LG}
            autoComplete="tel"
            inputMode="tel"
            required
          />
        </Field>

        {error !== null && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}

        <Button type="submit" variant="primary" block>
          Continue
        </Button>
      </form>
    </SiteFrame>
  );
}
