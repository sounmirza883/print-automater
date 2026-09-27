import type {
  NotificationItem,
  Page,
  DeliveryStatus,
  JobFailureReason,
  ReprintReason,
  OrderStatus,
  PaymentStatus,
  Permission,
  PrinterStatus,
  QualityCheckStatus,
  ShopRejectionReason,
  UserRole,
} from "@print-automated/types";

// Single source of truth: these were hand-written string unions here, which
// drifted silently (OrderStatus missed the four Phase 18 statuses;
// PrinterStatus still had 4 of its 8 values since Phase 15.3), so a status
// the API could emit was a type error nowhere and a blank label everywhere.
// Re-exported, not redefined, so they cannot drift again. The public names
// api-client exposes are unchanged.
export type {
  NotificationItem,
  Page,
  DeliveryStatus,
  JobFailureReason,
  ReprintReason,
  OrderStatus,
  PaymentStatus,
  PrinterStatus,
  ShopRejectionReason,
};

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  /** 23.15: what `role` may do at this business (server ROLE_PERMISSIONS, display only). */
  permissions?: string[];
}

/** 23.15: GET /v1/shop/staff/me. */
export interface MyShopsResponse {
  user?: { id: string; name: string; email: string };
  shops: MyShopMembership[];
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
  /** The live (non-superseded) print jobs, newest first. */
  printJobs: ShopOrderJobSummary[];
  /** NOT_REQUIRED unless the business runs quality checks. */
  qualityCheckStatus: QualityCheckStatus | null;
  /** The optional delivery record. `address` is null (and `addressRedacted` true)
   * for a role without MANAGE_DELIVERY. */
  delivery: ShopOrderDelivery | null;
  /** 23.13/23.16 (always sent; optional so older fixtures still typecheck). The highest
   * priority among the current jobs, and the pricing-rule version the order was quoted under
   * (from its own snapshot; null when it predates versioning). */
  priority?: number;
  pricingRuleVersion?: number | null;
}

export interface ShopOrderJobSummary {
  id: string;
  status: string;
  printerName: string | null;
  blockedReason: string | null;
  failureReason: string | null;
  failureNote: string | null;
  reprint: { originalJobId: string; reason: string; additionalCostMinor: number } | null;
  /** 23.13 (always sent; optional here so older fixtures still typecheck). */
  attempt?: number;
  priority?: number;
  createdAt?: string;
  updatedAt?: string;
  pausedAt?: string | null;
  supersededAt?: string | null;
}

/** 23.13: one line of an order (GET /v1/shop/orders/:id). `id` is null for the single
 * line synthesised from an order not yet accepted. */
export interface ShopOrderItem {
  id: string | null;
  sequence: number;
  itemType: string;
  required: boolean;
  documentName: string;
  quantity: number;
  printConfiguration: unknown;
  status: string | null;
  priceMinor: number | null;
}

export interface ShopOrderCustomerContact {
  kind: "WALK_IN" | "ACCOUNT";
  name: string;
  phone: string | null;
  email: string | null;
  /** True when the caller's role cannot see phone/email (they arrive null). */
  contactRedacted?: boolean;
}

export interface ShopOrderPayment {
  provider: string;
  status: string;
  amountMinor: number;
  currency: string;
  paidAt: string | null;
}

/** 23.13/23.16: what GET /v1/shop/orders/:id returns on top of ShopOrderResponse. */
export interface ShopOrderDetail extends ShopOrderResponse {
  items: ShopOrderItem[];
  customerContact: ShopOrderCustomerContact;
  payment: ShopOrderPayment | null;
  refunds: { count: number; refundedMinor: number; pendingMinor: number; currency: string | null };
}

/** 23.13: one row of GET /v1/shop/orders/:id/history (oldest first). */
export interface OrderHistoryEvent {
  id: string;
  at: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  actor: { id: string; name: string } | null;
  metadata: unknown;
}

export interface ShopOrderDelivery {
  id: string;
  orderId: string;
  status: DeliveryStatus;
  address: string | null;
  addressRedacted?: boolean;
  courier: string | null;
  trackingNumber: string | null;
  feeMinor: number;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  /** 23.14 (always sent; optional so older fixtures still typecheck). */
  model?: string | null;
  location?: string | null;
  maintenanceStatus?: string | null;
  lastStatusAt?: string | null;
}

/** 23.14: GET /v1/shop/printers/:id. */
export interface PrinterDetail extends PrinterResponse {
  connectionType: string | null;
  supportedSizes: string[];
  supportedPaperTypes: string[];
  maxJobPages: number | null;
  lastSeenAt: string | null;
  pageLimitPeriodStart: string;
  activeJobs: number;
  rules: Array<{ id: string; name: string; action: string; enabled: boolean; position: number }>;
}

/** Mirrors services/api's `ShopStaffService.MyShopMembership`. */
export interface MyShopMembership {
  id: string;
  name: string;
  /** The caller's EFFECTIVE role at this business (`ShopStaff.role`), which
   * is what decides what they may do there -- not the account-level role. */
  role: UserRole;
  /** 23.15: what `role` may do at this business -- the server's own ROLE_PERMISSIONS entry,
   * so a client never keeps a copy of that table. Display only: the server authorises every
   * request. Optional only so older fixtures compile; the API always sends it, and a client
   * must treat a missing list as "no permissions". */
  permissions?: Permission[];
}
