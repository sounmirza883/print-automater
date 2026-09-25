import type {
  JobFailureReason,
  OrderStatus,
  PaymentStatus,
  PrinterStatus,
  ShopRejectionReason,
  UserRole,
} from "@print-automated/types";

// Single source of truth: these were hand-written string unions here, which
// drifted silently (OrderStatus missed the four Phase 18 statuses;
// PrinterStatus still had 4 of its 8 values since Phase 15.3), so a status
// the API could emit was a type error nowhere and a blank label everywhere.
// Re-exported, not redefined, so they cannot drift again. The public names
// api-client exposes are unchanged.
export type { JobFailureReason, OrderStatus, PaymentStatus, PrinterStatus, ShopRejectionReason };

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

/** Mirrors services/api's `AuthResult` (services/api/src/auth/auth.service.ts).
 * There is no shared-schema/OpenAPI generation step in this project, so this
 * is kept in sync by hand -- if the backend's response shape changes, this
 * type (and the resource methods that return it) must change with it. */
export interface AuthResult extends AuthTokens {
  user: AuthUser;
}

/** Mirrors services/api's `DocumentStatus` Prisma enum. Not imported from
 * `@prisma/client` directly -- that package is generated against the
 * database schema and is a backend-only dependency; a frontend bundle
 * (web/mobile) has no business pulling it in. */
export type DocumentStatus = "PENDING_UPLOAD" | "PROCESSING" | "READY" | "REJECTED" | "DELETED";

/** Mirrors services/api's `CreateDocumentResult` / `DocumentStatusView`
 * (services/api/src/documents/documents.service.ts). */
export interface CreateDocumentResult {
  documentId: string;
  uploadUrl: string;
}

export interface DocumentStatusView {
  id: string;
  filename: string;
  status: DocumentStatus;
  pageCount: number | null;
  rejectionReason: string | null;
  createdAt: string;
}

// `OrderStatus`, `PaymentStatus` and `ShopRejectionReason` are re-exported
// from @print-automated/types at the top of this file.

/** Mirrors services/api's `ShopOrdersService.ShopOrderResponse`
 * (8.2/8.3). `pricingSnapshot` is optional for the same reason
 * customer-web's own `OrderListItem` (lib/orders.ts) treats it as
 * optional -- a real order's quote always exists, but this shared dev
 * database has accumulated test-fixture rows that bypass it. */
export interface ShopOrderResponse {
  id: string;
  publicOrderNumber: string;
  customerName: string;
  documentFilename: string;
  printConfiguration: {
    pages: { mode: "all" } | { mode: "range"; from: number; to: number };
    copies: number;
    paperSize: string;
    color: string;
    sides: string;
    orientation: string;
  };
  pricingSnapshot?: { quote?: { totalMinor: number; currency: string } };
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  createdAt: string;
  printerName: string | null;
}

export interface ShopOrdersGrouped {
  needsAttention: ShopOrderResponse[];
  printing: ShopOrderResponse[];
  ready: ShopOrderResponse[];
  completed: ShopOrderResponse[];
  failed: ShopOrderResponse[];
}

/** Mirrors packages/types' `PrinterCapabilities`. `PrinterStatus` is
 * re-exported from @print-automated/types at the top of this file. */
export interface PrinterCapabilities {
  color: boolean;
  duplex: boolean;
  a4: boolean;
  a3: boolean;
}

export interface PrinterResponse {
  id: string;
  shopId: string;
  name: string;
  capabilities: PrinterCapabilities | null;
  status: PrinterStatus;
  createdAt: string;
  /** 19.2 (PRD 41). `remainingAllowance` is null when enforcement is
   * disabled or no limit is set. */
  pageLimit: number | null;
  pageLimitEnabled: boolean;
  pageLimitPeriod: "DAILY" | "WEEKLY" | "MONTHLY";
  pagesUsedInPeriod: number;
  remainingAllowance: number | null;
}

/** Mirrors services/api's `ShopStaffService.MyShopMembership`. */
export interface MyShopMembership {
  id: string;
  name: string;
}
