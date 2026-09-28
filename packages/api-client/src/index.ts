export { ApiClient } from "./client.js";
export { HttpClient, type HttpClientOptions, type RequestOptions } from "./http-client.js";
export { ApiClientError } from "./errors/api-client-error.js";
export type { AuthStrategy } from "./auth/auth-strategy.js";
export { CookieAuthStrategy, type CookieAuthStrategyOptions } from "./auth/cookie-auth-strategy.js";
export {
  BearerTokenAuthStrategy,
  InMemoryTokenStorage,
  type BearerTokenAuthStrategyOptions,
  type TokenStorage,
} from "./auth/bearer-token-auth-strategy.js";
export { AuthResource } from "./resources/auth.resource.js";
export { DocumentsResource } from "./resources/documents.resource.js";
export { ShopOrdersResource } from "./resources/shop-orders.resource.js";
export {
  PrintersResource,
  type PairingCode,
  type RegisterPrinterInput,
  type UpdatePrinterInput,
} from "./resources/printers.resource.js";
export {
  ShopStaffResource,
  type ShopStaffListItem,
  type ShopStaffMember,
  type StaffDirectoryItem,
  type StaffInvite,
} from "./resources/shop-staff.resource.js";
export {
  PrintJobsResource,
  type PrintJobActionResult,
  type ReprintResult,
} from "./resources/print-jobs.resource.js";
export type {
  InventoryItem,
  InventoryItemInput,
  InventoryAlert,
  InventorySummary,
  InventoryMovement,
  Supplier,
  SupplierInput,
  SupplierProduct,
  PurchaseOrder,
  PurchaseOrderLine,
} from "./resources/inventory.resource.js";
export type {
  Product,
  ProductInput,
  ProductUpdateInput,
  PricingRule,
  PricingRuleInput,
  Customer,
  CustomerInput,
  CustomerUpdateInput,
} from "./resources/catalog.resource.js";
export type {
  ShopSettings,
  ShopSettingsPatch,
  OperatingHours,
  PrinterRule,
  PrinterRuleInput,
} from "./resources/settings.resource.js";
export { DashboardResource } from "./resources/dashboard.resource.js";
export { PlanResource } from "./resources/plan.resource.js";
export { AdminResource } from "./resources/admin.resource.js";
export {
  ReportsResource,
  type ReportName,
  type ReportParams,
} from "./resources/reports.resource.js";
export {
  NotificationsResource,
  type NotificationFilter,
} from "./resources/notifications.resource.js";
export type {
  Page,
  AuthTokens,
  AuthUser,
  AuthResult,
  DocumentStatus,
  CreateDocumentResult,
  DocumentStatusView,
  OrderStatus,
  PaymentStatus,
  JobFailureReason,
  DeliveryStatus,
  ReprintReason,
  ShopRejectionReason,
  ShopOrderResponse,
  ShopOrderJobSummary,
  ShopOrderItem,
  ShopOrderCustomerContact,
  ShopOrderPayment,
  ShopOrderDetail,
  OrderHistoryEvent,
  ShopOrderDelivery,
  ShopOrdersGrouped,
  PrinterCapabilities,
  PrinterStatus,
  PrinterResponse,
  PrinterDetail,
  MyShopMembership,
  MyShopsResponse,
} from "./types.js";
export {
  availableJobActions,
  availableOrderActions,
  shouldSteerToReprint,
  type Can,
  type JobActions,
  type OrderActions,
} from "./order-actions.js";
export {
  describeBlockedReason,
  humanizeEnum,
  instructionSummary,
  isHeldByLatePrint,
  jobStatusTone,
  priorityLabel,
  type BlockedFix,
  type BlockedReasonView,
  type JobInstructions,
  type Tone,
} from "./job-wording.js";
