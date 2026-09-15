"use client";

import { useCallback, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { runUploadFlow, type UploadState } from "@/lib/upload-document";

const BUSY_LABELS: Record<string, string> = {
  creating: "Preparing upload…",
  confirming: "Confirming…",
  processing: "Checking your document…",
};

export default function UploadPage(): ReactNode {
  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback((file: File) => {
    void runUploadFlow(file, setState);
  }, []);

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

  const isBusy = !["idle", "ready", "rejected", "error"].includes(state.phase);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-bold">Upload your document</h1>

      {(state.phase === "idle" || isBusy) && (
        <div
          onDrop={handleDrop}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-16 text-center"
          style={{ borderColor: isDragging ? "var(--color-primary-action)" : "#d1d5db" }}
        >
          {isBusy ? (
            <UploadProgress state={state} />
          ) : (
            <>
              <p className="text-gray-600">Drag and drop a PDF here, or</p>
              <label
                className="cursor-pointer rounded-md px-4 py-2 font-semibold text-white"
                style={{ backgroundColor: "var(--color-primary-action)" }}
              >
                Choose a file
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={handleFileInputChange}
                />
              </label>
            </>
          )}
        </div>
      )}

      {state.phase === "ready" && (
        <div role="status" className="rounded-md border border-gray-300 p-4">
          <p className="font-semibold">{state.filename} is ready.</p>
          <p className="text-sm text-gray-600">
            Configuring pages, copies, and a shop lands here in a later phase.
          </p>
        </div>
      )}

      {state.phase === "rejected" && (
        <div
          role="alert"
          className="rounded-md border p-4"
          style={{ borderColor: "var(--color-error)", color: "var(--color-error)" }}
        >
          <p className="font-semibold">{state.reason}</p>
        </div>
      )}

      {state.phase === "error" && (
        <div
          role="alert"
          className="rounded-md border p-4"
          style={{ borderColor: "var(--color-error)", color: "var(--color-error)" }}
        >
          <p>{state.message}</p>
        </div>
      )}
    </main>
  );
}

function UploadProgress({ state }: { state: UploadState }): ReactNode {
  if (state.phase === "uploading") {
    return (
      <div className="flex flex-col items-center gap-2">
        <p>Uploading…</p>
        <p className="text-sm text-gray-600">{state.progress}%</p>
      </div>
    );
  }
  return <p>{BUSY_LABELS[state.phase] ?? "Working…"}</p>;
}
