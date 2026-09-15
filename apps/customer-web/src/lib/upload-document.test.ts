import {
  runUploadFlow,
  type UploadDeps,
  type UploadState,
  type DocumentStatusView,
} from "./upload-document.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pdfFile(name = "assignment.pdf"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "application/pdf" });
}

/** Scripts an exact sequence of fetch responses (create, confirm, then
 * one entry per poll) -- the seam upload-document.ts exists to make
 * testable, per its own module doc comment. */
function depsWithResponses(
  responses: Response[],
  uploadFile: UploadDeps["uploadFile"],
): UploadDeps {
  let call = 0;
  return {
    fetchImpl: (async () => {
      const response = responses[call];
      call += 1;
      if (!response) {
        throw new Error(`No scripted response for fetch call #${call}`);
      }
      return response;
    }) as unknown as typeof fetch,
    uploadFile,
  };
}

const instantUpload: UploadDeps["uploadFile"] = async (_url, _file, onProgress) => {
  onProgress(100);
};

describe("runUploadFlow", () => {
  it("rejects a non-PDF file immediately, before any network call", async () => {
    const states: UploadState[] = [];
    const fetchImpl = jest.fn();
    await runUploadFlow(
      new File(["x"], "photo.jpg", { type: "image/jpeg" }),
      (s) => states.push(s),
      { fetchImpl: fetchImpl as unknown as typeof fetch, uploadFile: instantUpload },
    );

    expect(states).toEqual([{ phase: "error", message: "Please choose a PDF file." }]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("the happy path: create -> upload (with progress) -> confirm -> poll -> ready", async () => {
    const processing: DocumentStatusView = {
      id: "doc-1",
      filename: "assignment.pdf",
      status: "PROCESSING",
      pageCount: null,
      rejectionReason: null,
      createdAt: "2026-01-01",
    };
    const ready: DocumentStatusView = { ...processing, status: "READY", pageCount: 3 };

    const deps = depsWithResponses(
      [
        jsonResponse(201, {
          documentId: "doc-1",
          uploadUrl: "https://minio.local/quarantine/doc-1",
        }),
        jsonResponse(200, processing), // confirm response
        jsonResponse(200, processing), // first poll: still processing
        jsonResponse(200, ready), // second poll: ready
      ],
      instantUpload,
    );

    const states: UploadState[] = [];
    await runUploadFlow(pdfFile(), (s) => states.push(s), deps);

    expect(states).toEqual([
      { phase: "creating" },
      { phase: "uploading", progress: 0 },
      { phase: "uploading", progress: 100 },
      { phase: "confirming" },
      { phase: "processing" },
      { phase: "ready", documentId: "doc-1", filename: "assignment.pdf" },
    ]);
  });

  it.each([
    "The file is not a valid PDF.",
    "The file exceeds the 25MB size limit.",
    "The file failed a security scan and cannot be accepted.",
    "The document exceeds the 500-page limit.",
    "Password-protected PDFs are not supported. Please remove the password and try again.",
    "The file could not be read as a valid PDF.",
  ])(
    "§4.5: each 2.7 rejection reason reaches the UI as its own distinct, verbatim message -- %s",
    async (rejectionReason) => {
      const deps = depsWithResponses(
        [
          jsonResponse(201, {
            documentId: "doc-2",
            uploadUrl: "https://minio.local/quarantine/doc-2",
          }),
          jsonResponse(200, {
            id: "doc-2",
            filename: "bad.pdf",
            status: "PROCESSING",
            pageCount: null,
            rejectionReason: null,
            createdAt: "2026-01-01",
          }),
          jsonResponse(200, {
            id: "doc-2",
            filename: "bad.pdf",
            status: "REJECTED",
            pageCount: null,
            rejectionReason,
            createdAt: "2026-01-01",
          }),
        ],
        instantUpload,
      );

      const states: UploadState[] = [];
      await runUploadFlow(pdfFile("bad.pdf"), (s) => states.push(s), deps);

      expect(states.at(-1)).toEqual({ phase: "rejected", reason: rejectionReason });
    },
  );

  it("surfaces the server's own error message when document creation is refused", async () => {
    const deps = depsWithResponses(
      [
        jsonResponse(429, {
          error_code: "RATE_LIMITED",
          message: "Too many uploads -- please wait a moment.",
          retryable: true,
          request_id: "req-1",
        }),
      ],
      instantUpload,
    );

    const states: UploadState[] = [];
    await runUploadFlow(pdfFile(), (s) => states.push(s), deps);

    expect(states.at(-1)).toEqual({
      phase: "error",
      message: "Too many uploads -- please wait a moment.",
    });
  });

  it("reports a failed presigned upload without a stale, misleading confirm/poll afterward", async () => {
    const deps = depsWithResponses(
      [
        jsonResponse(201, {
          documentId: "doc-3",
          uploadUrl: "https://minio.local/quarantine/doc-3",
        }),
      ],
      async () => {
        throw new Error("network died mid-upload");
      },
    );

    const states: UploadState[] = [];
    await runUploadFlow(pdfFile(), (s) => states.push(s), deps);

    expect(states).toEqual([
      { phase: "creating" },
      { phase: "uploading", progress: 0 },
      { phase: "error", message: "The upload failed. Please try again." },
    ]);
  });

  it("times out rather than polling forever if the document never settles", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick"] });
    try {
      const processing: DocumentStatusView = {
        id: "doc-4",
        filename: "slow.pdf",
        status: "PROCESSING",
        pageCount: null,
        rejectionReason: null,
        createdAt: "2026-01-01",
      };
      // create resolves immediately; every subsequent poll reports
      // PROCESSING forever -- fast-forwarding through the real
      // POLL_INTERVAL_MS/POLL_TIMEOUT_MS timers is what proves this
      // gives up rather than polling indefinitely.
      const states: UploadState[] = [];
      const flow = runUploadFlow(pdfFile("slow.pdf"), (s) => states.push(s), {
        fetchImpl: (async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url === "/api/documents") {
            return jsonResponse(201, {
              documentId: "doc-4",
              uploadUrl: "https://minio.local/quarantine/doc-4",
            });
          }
          return jsonResponse(200, processing);
        }) as unknown as typeof fetch,
        uploadFile: instantUpload,
      });

      await jest.advanceTimersByTimeAsync(70_000);
      await flow;

      expect(states.at(-1)).toEqual({
        phase: "error",
        message: "This is taking longer than expected. Check back on this page shortly.",
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
