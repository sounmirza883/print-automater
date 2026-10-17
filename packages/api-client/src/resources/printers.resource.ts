import type { HttpClient } from "../http-client.js";
import type {
  Page,
  PrinterCapabilities,
  PrinterDetail,
  PrinterResponse,
  PrinterStatus,
} from "../types.js";

export interface RegisterPrinterInput {
  shopId: string;
  name: string;
  capabilities?: PrinterCapabilities;
}

/** A one-time code for pairing a shop computer's print agent: 8 characters, valid for ten
 * minutes, good for one pairing. */
export interface PairingCode {
  code: string;
  expiresAt: string;
  /** The branch the paired PC and its printers will belong to. */
  branchId?: string;
  branchName?: string;
}

export interface UpdatePrinterInput {
  name?: string;
  enabled?: boolean;
  capabilities?: PrinterCapabilities;
  /** null clears the limit; enforcement only applies while `pageLimitEnabled`. */
  pageLimit?: number | null;
  pageLimitEnabled?: boolean;
  pageLimitPeriod?: "DAILY" | "WEEKLY" | "MONTHLY";
}

export class PrintersResource {
  constructor(private readonly http: HttpClient) {}

  /** `branchId` narrows to one branch (a branch-bound person is always limited to their own by the
   * server); omit it for every branch the caller may see. */
  list(shopId: string, branchId?: string): Promise<PrinterResponse[]> {
    return this.http.request<PrinterResponse[]>("/v1/shop/printers", {
      query: { shopId, branchId },
    });
  }

  /** 23.6: a page of printers, optionally searched (`q`) or filtered by status. */
  listPage(
    shopId: string,
    params: {
      q?: string;
      status?: PrinterStatus;
      branchId?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Page<PrinterResponse>> {
    return this.http.request<Page<PrinterResponse>>("/v1/shop/printers", {
      query: { shopId, ...params, limit: params.limit ?? 50 },
    });
  }

  /** 23.14: capabilities, page-limit usage, last seen and the rules that name this printer. */
  get(printerId: string): Promise<PrinterDetail> {
    return this.http.request<PrinterDetail>(`/v1/shop/printers/${printerId}`);
  }

  register(input: RegisterPrinterInput): Promise<PrinterResponse> {
    return this.http.request<PrinterResponse>("/v1/shop/printers", {
      method: "POST",
      body: input,
    });
  }

  update(printerId: string, input: UpdatePrinterInput): Promise<PrinterResponse> {
    return this.http.request<PrinterResponse>(`/v1/shop/printers/${printerId}`, {
      method: "PATCH",
      body: input,
    });
  }

  /** The agent's printers appear on their own once it is paired: its heartbeat reports them, and
   * they belong to the branch the code was issued for. A branch-bound person's code is always for
   * their own branch; otherwise name the branch (or omit it in a one-branch business). */
  issuePairingCode(shopId: string, branchId?: string): Promise<PairingCode> {
    return this.http.request<PairingCode>("/v1/shop/agents/pairing-code", {
      method: "POST",
      body: { shopId, ...(branchId !== undefined ? { branchId } : {}) },
    });
  }

  /** Owners only. Moves this printer's paired PC, together with every printer on it, to another
   * branch. Refused while any of them has a queued or printing job. Answers with the printers
   * that moved. */
  moveBranch(printerId: string, branchId: string): Promise<PrinterResponse[]> {
    return this.http.request<PrinterResponse[]>(`/v1/shop/printers/${printerId}/branch`, {
      method: "PUT",
      body: { branchId },
    });
  }

  remove(printerId: string): Promise<void> {
    return this.http.request<void>(`/v1/shop/printers/${printerId}`, { method: "DELETE" });
  }
}
