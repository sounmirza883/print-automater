"use client";

import { useState, type ReactNode } from "react";
import { ErrorBanner, TextAreaField } from "@/components/form-kit";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { ResourceBoundary } from "@/components/resource-boundary";
import { Button, Panel } from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

const noop = (): void => undefined;

/** Where owners are told to send their plan payments -- one platform-wide text, edited
 * here and shown on every owner's Billing page. */
export function PaymentInstructionsPanel(): ReactNode {
  const state = useResource(() => getApi().paymentProofs.adminInstructions(), []);
  return (
    <Panel title="Payment instructions">
      <ResourceBoundary state={state} what="payment instructions">
        {(data) => (
          // Keyed by the saved version, so the draft restarts from what was last stored.
          <InstructionsEditor
            key={data.updatedAt}
            initial={data.paymentInstructions}
            updatedAt={data.updatedAt}
            onSaved={state.reload}
          />
        )}
      </ResourceBoundary>
    </Panel>
  );
}

function InstructionsEditor({
  initial,
  updatedAt,
  onSaved,
}: {
  initial: string;
  updatedAt: string;
  onSaved: () => void;
}): ReactNode {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);
  const runner = useActionRunner(noop);
  const dirty = draft.trim() !== initial.trim();

  function save(): void {
    setSaved(false);
    void runner
      .run(async () => {
        await getApi().paymentProofs.adminUpdateInstructions(draft);
      })
      .then((outcome) => {
        if (outcome === "ok") {
          setSaved(true);
          onSaved();
        }
      });
  }

  return (
    <div className="grid gap-3">
      <TextAreaField
        label="Bank, Easypaisa or JazzCash details shown to owners"
        value={draft}
        onChange={(value) => {
          setSaved(false);
          setDraft(value);
        }}
        maxLength={5000}
        rows={6}
      />
      <ErrorBanner message={runner.error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={save} disabled={runner.busy || !dirty}>
          {runner.busy ? "Saving…" : "Save instructions"}
        </Button>
        {saved && (
          <span role="status" className="text-sm text-good-fg">
            Saved.
          </span>
        )}
        <span className="text-xs text-muted">Last saved {formatDateTime(updatedAt)}</span>
      </div>
    </div>
  );
}
