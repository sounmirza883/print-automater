"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui";
import { previewKind } from "@/lib/billing-view";

/** Shows a stored payment proof: an image inline, a PDF in a frame. The file comes through
 * the authenticated API as a Blob (never a public link), so it is turned into a short-lived
 * object URL here and released when the preview goes away or another proof is shown.
 * `proofId` is the identity: a different proof mounts a fresh loader (so no state is ever
 * reset from inside an effect). */
export function ProofPreview(props: {
  proofId: string;
  contentType: string;
  fileName: string;
  load: () => Promise<Blob>;
}): ReactNode {
  return <LoadedProof key={props.proofId} {...props} />;
}

function LoadedProof({
  contentType,
  fileName,
  load,
}: {
  proofId: string;
  contentType: string;
  fileName: string;
  load: () => Promise<Blob>;
}): ReactNode {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    loadRef
      .current()
      .then((blob) => {
        if (cancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl !== null) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, []);

  if (failed) {
    return (
      <p
        role="alert"
        className="rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-sm"
      >
        The file could not be loaded. Try again in a moment.
      </p>
    );
  }
  if (url === null) {
    return <Skeleton className="h-64 w-full" />;
  }
  return (
    <div className="grid gap-2">
      {previewKind(contentType) === "pdf" ? (
        <iframe
          src={url}
          title={`Payment proof ${fileName}`}
          className="h-96 w-full rounded-md border border-line bg-panel-2"
        />
      ) : (
        <img
          src={url}
          alt={`Payment proof ${fileName}`}
          className="max-h-96 w-full rounded-md border border-line bg-panel-2 object-contain"
        />
      )}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-muted underline underline-offset-2"
      >
        Open {fileName} in a new tab
      </a>
    </div>
  );
}
