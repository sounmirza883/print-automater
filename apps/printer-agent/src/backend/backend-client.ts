import type { ApiError, PrintConfiguration } from "@print-automated/types";
import type { HeartbeatInput } from "@print-automated/validation";
import type pino from "pino";

export interface PrintJobSummary {
  id: string;
  orderId: string;
  printerId: string;
  printerName: string;
  status: string;
  claimedAt: string | null;
  createdAt: string;
  printConfiguration: PrintConfiguration;
}

export class BackendError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string,
    public readonly retryable: boolean,
    public readonly status: number,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

/** §9.5/9.3. Thin wrapper over the three endpoints that establish and
 * maintain this device's identity with the backend -- register once
 * (pairing), authenticate whenever the short-lived agent JWT is
 * missing or expired, heartbeat periodically once printers exist
 * (9.6+). Deliberately does not retry internally: callers (the
 * loopback server's pairing handler, the eventual dispatch loop) each
 * have their own idea of what a failure should mean to the user, and
 * swallowing that here would hide it from them. */
export class BackendClient {
  constructor(
    private readonly baseUrl: string,
    private readonly logger: pino.Logger,
  ) {}

  async registerAgent(
    pairingCode: string,
    deviceId: string,
    publicKey: string,
  ): Promise<{ deviceId: string; shopId: string }> {
    return this.post("/v1/agents/register", { pairingCode, deviceId, publicKey });
  }

  async fetchChallenge(deviceId: string): Promise<string> {
    const { nonce } = await this.post<{ nonce: string }>("/v1/agents/authenticate/challenge", {
      deviceId,
    });
    return nonce;
  }

  async authenticate(deviceId: string, signature: string): Promise<string> {
    const { accessToken } = await this.post<{ accessToken: string }>("/v1/agents/authenticate", {
      deviceId,
      signature,
    });
    return accessToken;
  }

  async sendHeartbeat(accessToken: string, printers: HeartbeatInput["printers"]): Promise<void> {
    await this.post("/v1/agents/heartbeat", { printers }, accessToken);
  }

  /** §9.7. `waitSeconds` mirrors the server's own cap (25s) -- this
   * call is expected to sit open for up to that long, which is exactly
   * why it's never routed through the same code path as the short
   * request/response calls above without a null-on-204 case: a normal,
   * frequent "nothing to do" response, not an error. */
  async pollJobs(accessToken: string, waitSeconds: number): Promise<PrintJobSummary | null> {
    const url = `${this.baseUrl}/v1/agents/jobs?wait=${waitSeconds}`;
    let response: Response;
    try {
      response = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    } catch {
      throw new BackendError("Could not reach the backend.", "NETWORK_ERROR", true, 0);
    }
    if (response.status === 204) {
      return null;
    }
    if (!response.ok) {
      throw await BackendClient.toBackendError(response);
    }
    return (await response.json()) as PrintJobSummary;
  }

  async claimJob(accessToken: string, jobId: string): Promise<PrintJobSummary> {
    return this.post(`/v1/agents/jobs/${jobId}/claim`, undefined, accessToken);
  }

  private async post<T>(path: string, body: unknown, accessToken?: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.logger.warn({ err, url }, "backend request failed to send");
      throw new BackendError("Could not reach the backend.", "NETWORK_ERROR", true, 0);
    }

    if (!response.ok) {
      throw await BackendClient.toBackendError(response);
    }

    // Not every 2xx carries a body -- the heartbeat endpoint answers
    // `200` with nothing at all (NestJS sends an empty body for a
    // `void`-returning handler; it does not reserve that for `204`),
    // so branch on the actual bytes received rather than trusting the
    // status code to predict them.
    const text = await response.text();
    return (text.length === 0 ? undefined : JSON.parse(text)) as T;
  }

  private static async toBackendError(response: Response): Promise<BackendError> {
    const apiError = (await response.json().catch(() => null)) as ApiError | null;
    return new BackendError(
      apiError?.message ?? `Request failed with status ${response.status}`,
      apiError?.error_code ?? "UNKNOWN_ERROR",
      apiError?.retryable ?? response.status >= 500,
      response.status,
    );
  }
}
