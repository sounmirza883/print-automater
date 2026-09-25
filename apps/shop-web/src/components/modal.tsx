"use client";

import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui";

/** A modal on the native `<dialog>` element: focus is trapped and
 * restored by the browser, Escape closes it, the page behind is inert.
 * Mount it only while open. While `busy` (a request is in flight) it
 * cannot be dismissed, so an action is never abandoned half-submitted. */
export function Modal({
  title,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
    // No cleanup close(): unmounting removes the element (and its top-layer
    // state), and a close() here would fire a `close` event that, under React
    // StrictMode's mount/unmount/mount in dev, dismissed the dialog at once.
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        if (busy) {
          event.preventDefault();
        }
      }}
      onClose={onClose}
      className="m-auto w-[34rem] max-w-[94vw] rounded-lg border border-line bg-panel p-0 text-ink shadow-xl backdrop:bg-black/50"
    >
      <div className="border-b border-line px-5 py-3">
        <h2 id="modal-title" className="text-base font-semibold">
          {title}
        </h2>
      </div>
      {children}
    </dialog>
  );
}

/** A confirm/submit dialog: body, precise error from the last attempt,
 * Cancel and a submit button that disables while pending (no double
 * submit). `onSubmit` returns nothing; the caller closes on success. */
export function FormDialog({
  title,
  submitLabel,
  submitTone = "primary",
  busy,
  error,
  disabled = false,
  onSubmit,
  onCancel,
  children,
}: {
  title: string;
  submitLabel: string;
  submitTone?: "primary" | "danger";
  busy: boolean;
  error: string | null;
  disabled?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}): ReactNode {
  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!busy && !disabled) {
      onSubmit();
    }
  }
  return (
    <Modal title={title} onClose={onCancel} busy={busy}>
      <form onSubmit={handleSubmit}>
        <div className="grid gap-3 px-5 py-4 text-sm">{children}</div>
        {error !== null && (
          <p
            role="alert"
            className="mx-5 mb-3 rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-danger-fg"
          >
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <button
            type="submit"
            disabled={busy || disabled}
            className={`inline-flex min-h-9 items-center rounded-md border border-transparent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
              submitTone === "danger" ? "bg-danger" : "bg-accent"
            }`}
          >
            {busy ? "Working…" : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
