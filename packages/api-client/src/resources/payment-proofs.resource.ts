import type {
  BillingPlanOption,
  PaymentInstructionsResponse,
  PaymentProofListResponse,
  PaymentProofResponse,
  PaymentProofStatus,
} from "@print-automated/types";
import type { HttpClient } from "../http-client.js";

/** Mirrors `SubmitPaymentProofInput` from `@print-automated/validation`, kept as a plain
 * structural type like every other api-client request body. */
export interface SubmitPaymentProofBody {
  shopId: string;
  planDefinitionId: string;
  /** Integer minor units (paisa). */
  amountMinor: number;
  transactionRef: string;
  fileName: string;
  fileContentType: "image/jpeg" | "image/png" | "application/pdf";
  /** Raw base64 of the file (no `data:` prefix); at most 5 MB of file. */
  fileBase64: string;
}

export interface ApprovePaymentProofBody {
  /** Calendar months to grant (1 year = 12). */
  months: number;
  /** Defaults to the plan the owner chose when submitting. */
  planDefinitionId?: string;
}

export interface AdminListPaymentProofsQuery {
  status?: PaymentProofStatus;
  limit?: number;
  offset?: number;
}

/** Manual plan billing. The owner methods need the SHOP_OWNER role of the given
 * business; every `admin*` method needs the ADMIN role. Proof files are kept forever, so
 * `file()` / `adminFile()` work for approved and rejected proofs alike. */
export class PaymentProofsResource {
  constructor(private readonly http: HttpClient) {}

  submit(body: SubmitPaymentProofBody): Promise<PaymentProofResponse> {
    return this.http.request<PaymentProofResponse>("/v1/shop/payment-proofs", {
      method: "POST",
      body,
    });
  }

  /** The plans an owner can pay for (id, name, price); archived and contact-only are left out. */
  plans(): Promise<{ items: BillingPlanOption[] }> {
    return this.http.request<{ items: BillingPlanOption[] }>("/v1/shop/payment-proofs/plans");
  }

  list(shopId: string): Promise<PaymentProofResponse[]> {
    return this.http.request<PaymentProofResponse[]>("/v1/shop/payment-proofs", {
      query: { shopId },
    });
  }

  file(shopId: string, id: string): Promise<Blob> {
    return this.http.requestBlob(`/v1/shop/payment-proofs/${id}/file`, { query: { shopId } });
  }

  /** Where owners are told to send their plan payment (any shop staff may read). */
  instructions(): Promise<PaymentInstructionsResponse> {
    return this.http.request<PaymentInstructionsResponse>("/v1/shop/payment-instructions");
  }

  adminList(query: AdminListPaymentProofsQuery = {}): Promise<PaymentProofListResponse> {
    return this.http.request<PaymentProofListResponse>("/v1/admin/payment-proofs", {
      query: { status: query.status, limit: query.limit, offset: query.offset },
    });
  }

  adminGet(id: string): Promise<PaymentProofResponse> {
    return this.http.request<PaymentProofResponse>(`/v1/admin/payment-proofs/${id}`);
  }

  adminFile(id: string): Promise<Blob> {
    return this.http.requestBlob(`/v1/admin/payment-proofs/${id}/file`);
  }

  adminApprove(id: string, body: ApprovePaymentProofBody): Promise<PaymentProofResponse> {
    return this.http.request<PaymentProofResponse>(`/v1/admin/payment-proofs/${id}/approve`, {
      method: "POST",
      body,
    });
  }

  adminReject(id: string, reason: string): Promise<PaymentProofResponse> {
    return this.http.request<PaymentProofResponse>(`/v1/admin/payment-proofs/${id}/reject`, {
      method: "POST",
      body: { reason },
    });
  }

  adminInstructions(): Promise<PaymentInstructionsResponse> {
    return this.http.request<PaymentInstructionsResponse>("/v1/admin/payment-instructions");
  }

  adminUpdateInstructions(paymentInstructions: string): Promise<PaymentInstructionsResponse> {
    return this.http.request<PaymentInstructionsResponse>("/v1/admin/payment-instructions", {
      method: "PUT",
      body: { paymentInstructions },
    });
  }
}
