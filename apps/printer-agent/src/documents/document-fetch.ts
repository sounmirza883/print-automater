import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type pino from "pino";
import { BackendError } from "../backend/backend-client.js";
import { TMP_DIR } from "../config/paths.js";

/** §68/9.8. Streams `GET /agents/jobs/:id/document` to a `0600` temp
 * file under `%LOCALAPPDATA%\PrintAutomated\tmp` and hands back the
 * path -- the caller (9.9's print driver invocation) owns deleting it.
 * Not exported for direct use outside this module: `withJobDocument`
 * below is the only sanctioned way to get from a job id to a file on
 * disk, specifically so "delete it in a finally block" isn't
 * something every future caller has to remember to do correctly. */
async function fetchJobDocument(
  baseUrl: string,
  jobId: string,
  accessToken: string,
): Promise<string> {
  const url = `${baseUrl}/v1/agents/jobs/${jobId}/document`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  } catch {
    throw new BackendError("Could not reach the backend.", "NETWORK_ERROR", true, 0);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error_code?: string;
      message?: string;
      retryable?: boolean;
    } | null;
    throw new BackendError(
      body?.message ?? `Document fetch failed with status ${response.status}`,
      body?.error_code ?? "UNKNOWN_ERROR",
      body?.retryable ?? response.status >= 500,
      response.status,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const filePath = join(TMP_DIR, `${jobId}.pdf`);
  // 0600: this file briefly holds a customer's document in plaintext
  // outside the encrypted-at-rest boundary the backend otherwise
  // maintains end to end -- the same posture as the ledger (9.5) and
  // logs, restricted to this OS user only.
  await writeFile(filePath, bytes, { mode: 0o600 });
  return filePath;
}

/** §9.8's own Done-when, by construction: every *normal* completion of
 * `fn` -- success or a thrown error inside it -- runs the `finally`
 * and deletes the temp file, so "no temp file survives a normal run"
 * holds regardless of what `fn` does. Only a hard process kill (the
 * *other* half of the Done-when: force-killing the agent mid-print)
 * can skip this `finally` and leave the file behind, which is exactly
 * the case 11.6's startup sweeper exists to clean up later -- this
 * function's job is to make that the *only* way a temp file survives,
 * not to also implement the sweep itself. */
export async function withJobDocument<T>(
  baseUrl: string,
  jobId: string,
  accessToken: string,
  logger: pino.Logger,
  fn: (filePath: string) => Promise<T>,
): Promise<T> {
  const filePath = await fetchJobDocument(baseUrl, jobId, accessToken);
  try {
    return await fn(filePath);
  } finally {
    await rm(filePath, { force: true }).catch((err: unknown) => {
      logger.warn({ err, filePath }, "failed to remove temp document file");
    });
  }
}
