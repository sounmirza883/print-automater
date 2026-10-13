"use client";

import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { Button, Notice } from "@/components/ui";

/** A modal on the native `<dialog>` element: focus is trapped and
 * restored by the browser, Escape closes it, the page behind is inert.
 * Mount it only while open. While `busy` (a request is in flight) it
 * cannot be dismissed, so an action is never abandoned half-submitted. */
export function Modal({
  title,
  onClose,
  busy = false,
  dismissOnBackdrop = false,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  /** Close when the dimmed area outside the dialog is tapped. Off by default,
   * and left off for forms: a stray tap must not throw away what someone typed. */
  dismissOnBackdrop?: boolean;
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
      onClick={(event) => {
        // A click on the backdrop targets the dialog itself: its content fills its box.
        // close() rather than onClose(): the dialog's own `close` event then runs
        // onClose, and the browser returns focus to what opened the dialog.
        if (dismissOnBackdrop && !busy && event.target === event.currentTarget) {
          ref.current?.close();
        }
      }}
      className="m-auto w-[34rem] max-w-[94vw] rounded-lg border border-line bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/60 max-sm:mx-0 max-sm:mt-auto max-sm:mb-0 max-sm:max-h-[90vh] max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0"
    >
      <div className="border-b border-line py-4 pr-14 pl-5">
        <h2 id="modal-title" className="text-base font-semibold tracking-tight">
          {title}
        </h2>
      </div>
      {children}
      {/* Last in the DOM, placed top-right with CSS: `showModal()` focuses the
          first focusable element, so a dialog still opens on its first field or
          button, and Close comes last in the tab order. */}
      <button
        type="button"
        aria-label="Close dialog"
        disabled={busy}
        onClick={() => ref.current?.close()}
        className="absolute top-2.5 right-3 grid size-9 place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-ink disabled:opacity-50 max-sm:top-2 max-sm:size-11"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
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
      <form noValidate onSubmit={handleSubmit}>
        <div className="grid gap-3 px-5 py-4 text-sm">{children}</div>
        {error !== null && (
          <Notice tone="danger" role="alert" className="mx-5 mb-3">
            {error}
          </Notice>
        )}
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3 max-sm:flex-col-reverse">
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={submitTone === "danger" ? "danger" : "primary"}
            disabled={busy || disabled}
          >
            {busy ? "Working…" : submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
