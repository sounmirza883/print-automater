import type {
  BillingPlanOption,
  PaymentInstructionsResponse,
  PaymentProofListResponse,
  PaymentProofResponse,
  PaymentProofStatus,
  PaymentReportResponse,
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

/** `from` inclusive, `to` exclusive (ISO instants). `tzOffsetMinutes` is the viewer's offset from
 * UTC (Pakistan = 300) so "per day" means their day. `groupBy` defaults on the server: day for
 * ranges of up to ~2 months, month beyond. */
export interface PaymentReportQuery {
  from: string;
  to: string;
  groupBy?: "day" | "month";
  tzOffsetMinutes?: number;
}

export type PaymentReportFormat = "csv" | "xlsx";

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

  /** Money received (approved) vs not accepted (rejected) over a range, per currency. */
  adminReport(query: PaymentReportQuery): Promise<PaymentReportResponse> {
    return this.http.request<PaymentReportResponse>("/v1/admin/payment-reports", {
      query: { ...query },
    });
  }

  /** The same range as a CSV or Excel file, one row per payment. */
  adminExportReport(query: PaymentReportQuery, format: PaymentReportFormat): Promise<Blob> {
    return this.http.requestBlob("/v1/admin/payment-reports/export", {
      query: { ...query, format },
    });
  }
}
