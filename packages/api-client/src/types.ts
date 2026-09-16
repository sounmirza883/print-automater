import type { UserRole } from "@print-automated/types";

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

/** Mirrors services/api's `OrderStatus`/`PaymentStatus` Prisma enums --
 * same "not imported from @prisma/client" reasoning as DocumentStatus
 * above. */
export type OrderStatus =
  | "DRAFT"
  | "UPLOADED"
  | "PAYMENT_PENDING"
  | "PAID"
  | "WAITING_FOR_SHOP"
  | "SHOP_ACCEPTED"
  | "QUEUED_FOR_PRINT"
  | "PRINTING"
  | "PRINTED"
  | "READY_FOR_COLLECTION"
  | "COMPLETED"
  | "PAYMENT_FAILED"
  | "SHOP_REJECTED"
  | "PRINT_FAILED"
  | "PRINT_STATUS_UNKNOWN"
  | "CANCELLED"
  | "EXPIRED";

export type PaymentStatus =
  | "PENDING"
  | "AUTHORIZED"
  | "PAID"
  | "FAILED"
  | "CANCELLED"
  | "REFUND_PENDING"
  | "REFUNDED"
  | "REFUND_FAILED";

export type ShopRejectionReason =
  "PRINTER_UNAVAILABLE" | "CAPABILITY_UNAVAILABLE" | "SHOP_UNAVAILABLE" | "DOCUMENT_ISSUE";

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
}

export interface ShopOrdersGrouped {
  needsAttention: ShopOrderResponse[];
  printing: ShopOrderResponse[];
  ready: ShopOrderResponse[];
  completed: ShopOrderResponse[];
  failed: ShopOrderResponse[];
}

/** Mirrors packages/types' `PrinterCapabilities` / services/api's
 * `PrinterStatus` Prisma enum. */
export interface PrinterCapabilities {
  color: boolean;
  duplex: boolean;
  a4: boolean;
  a3: boolean;
}

export type PrinterStatus = "ONLINE" | "OFFLINE" | "ERROR" | "DISABLED";

export interface PrinterResponse {
  id: string;
  shopId: string;
  name: string;
  capabilities: PrinterCapabilities | null;
  status: PrinterStatus;
  createdAt: string;
}

/** Mirrors services/api's `ShopStaffService.MyShopMembership`. */
export interface MyShopMembership {
  id: string;
  name: string;
}
