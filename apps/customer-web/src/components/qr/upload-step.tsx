"use client";

import { useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { buttonClass, Notice, SiteFrame } from "@/components/ui";
import { StepIndicator } from "@/components/qr/step-indicator";
import { runPublicUploadFlow, type PublicUploadState } from "@/lib/public-upload";

const BUSY_LABELS: Record<string, string> = {
  creating: "Preparing upload…",
  confirming: "Confirming…",
  processing: "Checking your document…",
};

/** Step 2: drag and drop, or a file picker, into the public upload flow.
 * A 409 here (the first call
 * this whole page ever makes to the backend) is where a shop that
 * doesn't exist, isn't OPEN, or was given a malformed id first surfaces
 * -- there is no earlier "is this shop open" check to make, since
 * there's no public single-shop lookup route to make one against. */
export function UploadStep({
  shopId,
  onReady,
}: {
  shopId: string;
  onReady: (documentId: string, filename: string, pageCount: number | null) => void;
}): ReactNode {
  const [state, setState] = useState<PublicUploadState>({ phase: "idle" });
  const [isDragging, setIsDragging] = useState(false);

  function handleFile(file: File): void {
    void runPublicUploadFlow(shopId, file, (next) => {
      setState(next);
      if (next.phase === "ready") {
        onReady(next.documentId, next.filename, next.pageCount);
      }
    });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  }

  // "ready" never actually renders below -- onReady above moves the
  // wizard to the "configure" step in the same tick, unmounting this
  // component -- but it's still excluded here rather than left to fall
  // through to the generic "Working…" busy label.
  const isBusy = !["idle", "ready", "rejected", "error"].includes(state.phase);

  return (
    <SiteFrame width="narrow">
      <StepIndicator current={2} />

      <div className="grid gap-6">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Upload your document</h1>

        <div
          onDrop={handleDrop}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-5 py-12 text-center sm:py-16 ${
            isDragging ? "border-ink bg-panel-2" : "border-line-strong"
          }`}
        >
          {isBusy ? (
            <UploadProgress state={state} />
          ) : (
            <>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="size-6 text-muted"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 16V4" />
                <path d="m7 9 5-5 5 5" />
                <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
              </svg>
              <p className="hidden text-muted sm:block">Drag and drop a file here, or</p>
              <label
                className={`relative cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent-fg ${buttonClass({ variant: "primary", block: true })}`}
              >
                Choose a file
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,.docx"
                  className="sr-only"
                  onChange={handleFileInputChange}
                />
              </label>
              <p className="text-xs text-muted">PDF, JPEG, PNG, or Word (.docx), up to 25MB.</p>
            </>
          )}
        </div>

        {state.phase === "rejected" && (
          <Notice tone="danger" role="alert" className="font-semibold">
            {state.reason}
          </Notice>
        )}

        {state.phase === "error" && (
          <Notice tone="danger" role="alert">
            {state.message}
          </Notice>
        )}
      </div>
    </SiteFrame>
  );
}

function UploadProgress({ state }: { state: PublicUploadState }): ReactNode {
  if (state.phase === "uploading") {
    return (
      <div className="flex w-full flex-col items-center gap-3">
        <p>Uploading…</p>
        <div
          role="progressbar"
          aria-label="Upload progress"
          aria-valuenow={state.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 w-full overflow-hidden rounded-full bg-panel-2"
        >
          <div className="h-full bg-inv" style={{ width: `${state.progress}%` }} />
        </div>
        <p className="num text-sm text-muted">{state.progress}%</p>
      </div>
    );
  }
  return <p>{BUSY_LABELS[state.phase] ?? "Working…"}</p>;
}
