export type UploadState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "uploading"; progress: number }
  | { phase: "confirming" }
  | { phase: "processing" }
  | { phase: "ready"; documentId: string; filename: string }
  | { phase: "rejected"; reason: string }
  | { phase: "error"; message: string };

export interface DocumentStatusView {
  id: string;
  filename: string;
  status: "PENDING_UPLOAD" | "PROCESSING" | "READY" | "REJECTED" | "DELETED";
  pageCount: number | null;
  rejectionReason: string | null;
  createdAt: string;
}

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;

/** The two boundaries this module can't exercise directly under plain
 * Jest: `XMLHttpRequest` (for real upload progress -- Node has no
 * browser upload surface to fake meaningfully) and which `fetch` to
 * call through. Both are injectable so `upload-document.test.ts` can
 * script exact response sequences and assert on the resulting
 * `UploadState` transitions without a rendered browser -- the same
 * "real infra where it exists, a narrow seam where it genuinely can't"
 * approach as 3.4's SecureStore mock. `app/upload/page.tsx` uses the
 * real defaults. */
export interface UploadDeps {
  fetchImpl: typeof fetch;
  uploadFile: (url: string, file: File, onProgress: (percent: number) => void) => Promise<void>;
}

export const defaultUploadDeps: UploadDeps = {
  fetchImpl: (...args) => fetch(...args),
  uploadFile: uploadWithProgressXhr,
};

/** A real XHR (not `fetch`, which has no upload-progress event) PUT to
 * the presigned URL -- unauthenticated by design (2.5/2.6: the
 * presigned URL's own signature and short TTL are the security
 * boundary, not a bearer token; this call never goes through the
 * `/api/documents*` proxy at all). */
function uploadWithProgressXhr(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}.`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed.")));
    xhr.send(file);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Orchestrates the whole §4.5 flow: create -> presigned PUT (with
 * progress) -> confirm -> poll to a settled status. Each 2.7 rejection
 * reason reaches here as `rejectionReason`'s own already-specific,
 * already-actionable message (services/worker's `RejectionReason`
 * values ARE the message text, not a code this module would need its
 * own second mapping table for) -- this just displays it, via the
 * `"rejected"` state's `reason` field, verbatim. */
export async function runUploadFlow(
  file: File,
  onState: (state: UploadState) => void,
  deps: UploadDeps = defaultUploadDeps,
): Promise<void> {
  if (file.type !== "application/pdf") {
    onState({ phase: "error", message: "Please choose a PDF file." });
    return;
  }

  onState({ phase: "creating" });
  const createResponse = await deps.fetchImpl("/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, mimeType: file.type, sizeBytes: file.size }),
  });
  if (!createResponse.ok) {
    onState({ phase: "error", message: await errorMessage(createResponse) });
    return;
  }
  const { documentId, uploadUrl } = (await createResponse.json()) as {
    documentId: string;
    uploadUrl: string;
  };

  onState({ phase: "uploading", progress: 0 });
  try {
    await deps.uploadFile(uploadUrl, file, (progress) => onState({ phase: "uploading", progress }));
  } catch {
    onState({ phase: "error", message: "The upload failed. Please try again." });
    return;
  }

  onState({ phase: "confirming" });
  const confirmResponse = await deps.fetchImpl(`/api/documents/${documentId}/upload`, {
    method: "POST",
  });
  if (!confirmResponse.ok) {
    onState({ phase: "error", message: await errorMessage(confirmResponse) });
    return;
  }

  onState({ phase: "processing" });
  await pollUntilSettled(documentId, onState, deps);
}

async function pollUntilSettled(
  documentId: string,
  onState: (state: UploadState) => void,
  deps: UploadDeps,
): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await deps.fetchImpl(`/api/documents/${documentId}`);
    if (!response.ok) {
      onState({ phase: "error", message: await errorMessage(response) });
      return;
    }
    const doc = (await response.json()) as DocumentStatusView;

    if (doc.status === "READY") {
      onState({ phase: "ready", documentId, filename: doc.filename });
      return;
    }
    if (doc.status === "REJECTED") {
      onState({
        phase: "rejected",
        reason: doc.rejectionReason ?? "This file could not be accepted.",
      });
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }
  onState({
    phase: "error",
    message: "This is taking longer than expected. Check back on this page shortly.",
  });
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => undefined)) as { message?: unknown } | undefined;
  return typeof body?.message === "string"
    ? body.message
    : "Something went wrong. Please try again.";
}
