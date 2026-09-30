import { UNREACHABLE_MESSAGE, publicApiUrl, publicErrorMessage } from "./public-api";

export type PublicUploadState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "uploading"; progress: number }
  | { phase: "confirming" }
  | { phase: "processing" }
  | { phase: "ready"; documentId: string; filename: string; pageCount: number | null }
  | { phase: "rejected"; reason: string }
  | { phase: "error"; message: string };

export interface PublicDocumentStatusView {
  id: string;
  filename: string;
  status: "PENDING_UPLOAD" | "PROCESSING" | "READY" | "REJECTED" | "DELETED";
  pageCount: number | null;
  rejectionReason: string | null;
  createdAt: string;
}

/** Task 4's `CreateDocumentDto` accepts exactly these four mime types
 * (PDF, JPEG, PNG, DOCX -- normalised to a PDF by the worker). Not
 * imported from `@print-automated/validation` because that package's
 * own `ALLOWED_UPLOAD_MIME_TYPES` isn't part of its public export
 * surface (only `createDocumentSchema` itself is) -- the same
 * hardcode-the-check-here approach `upload-document.ts` already takes
 * for its own single-type (PDF-only) case. */
export const ALLOWED_PUBLIC_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;

/** Same injectable-boundary reasoning as `upload-document.ts`'s
 * `UploadDeps`: `XMLHttpRequest` (for real upload progress) and the
 * `fetch` used for every other call are both swappable so a future
 * unit test can script exact response sequences without a rendered
 * browser. `app/s/[shopId]/upload/page.tsx` uses the real defaults. */
export interface PublicUploadDeps {
  fetchImpl: typeof fetch;
  uploadFile: (url: string, file: File, onProgress: (percent: number) => void) => Promise<void>;
}

export const defaultPublicUploadDeps: PublicUploadDeps = {
  fetchImpl: (...args) => fetch(...args),
  uploadFile: uploadWithProgressXhr,
};

/** A real XHR PUT to the presigned URL -- unauthenticated by design,
 * exactly like the authenticated flow's own upload: the presigned
 * URL's signature and short TTL are the security boundary, not a
 * bearer token. It goes to object storage, not to the API. */
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

/** The guest-ordering equivalent of `runUploadFlow`: create -> presigned
 * PUT (with progress) -> confirm -> poll to a settled status, against the
 * API's own `/v1/public/shops/:shopId/documents*` (called straight from
 * the browser, see `public-api.ts`). A 409 on the very first call (a shop
 * that doesn't exist, isn't OPEN, or a malformed id) surfaces here as a
 * plain `"error"` state carrying the backend's own message -- there is no
 * separate "is this shop even open" check anywhere before this, since
 * there's no public single-shop lookup route to make one against. A call
 * that gets no answer at all (offline, or refused by CORS) also ends in
 * an `"error"` state rather than leaving the wizard stuck mid-step. */
export async function runPublicUploadFlow(
  shopId: string,
  file: File,
  onState: (state: PublicUploadState) => void,
  deps: PublicUploadDeps = defaultPublicUploadDeps,
): Promise<void> {
  try {
    await uploadAndSettle(shopId, file, onState, deps);
  } catch {
    onState({ phase: "error", message: UNREACHABLE_MESSAGE });
  }
}

async function uploadAndSettle(
  shopId: string,
  file: File,
  onState: (state: PublicUploadState) => void,
  deps: PublicUploadDeps,
): Promise<void> {
  if (!(ALLOWED_PUBLIC_UPLOAD_MIME_TYPES as readonly string[]).includes(file.type)) {
    onState({
      phase: "error",
      message: "Please choose a PDF, JPEG, PNG, or Word (.docx) file.",
    });
    return;
  }

  onState({ phase: "creating" });
  const createResponse = await deps.fetchImpl(
    publicApiUrl(`/v1/public/shops/${shopId}/documents`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, mimeType: file.type, sizeBytes: file.size }),
    },
  );
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
  const confirmResponse = await deps.fetchImpl(
    publicApiUrl(`/v1/public/shops/${shopId}/documents/${documentId}/upload`),
    { method: "POST" },
  );
  if (!confirmResponse.ok) {
    onState({ phase: "error", message: await errorMessage(confirmResponse) });
    return;
  }

  onState({ phase: "processing" });
  await pollUntilSettled(shopId, documentId, onState, deps);
}

async function pollUntilSettled(
  shopId: string,
  documentId: string,
  onState: (state: PublicUploadState) => void,
  deps: PublicUploadDeps,
): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await deps.fetchImpl(
      publicApiUrl(`/v1/public/shops/${shopId}/documents/${documentId}`),
    );
    if (!response.ok) {
      onState({ phase: "error", message: await errorMessage(response) });
      return;
    }
    const doc = (await response.json()) as PublicDocumentStatusView;

    if (doc.status === "READY") {
      onState({
        phase: "ready",
        documentId,
        filename: doc.filename,
        pageCount: doc.pageCount,
      });
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
    message: "This is taking longer than expected. Please try again.",
  });
}

function errorMessage(response: Response): Promise<string> {
  return publicErrorMessage(response, "Something went wrong. Please try again.");
}
