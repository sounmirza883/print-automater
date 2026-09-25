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
  type RegisterPrinterInput,
  type UpdatePrinterInput,
} from "./resources/printers.resource.js";
export { ShopStaffResource, type ShopStaffListItem } from "./resources/shop-staff.resource.js";
export { DashboardResource } from "./resources/dashboard.resource.js";
export { ReportsResource, type ReportParams } from "./resources/reports.resource.js";
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
  ShopOrdersGrouped,
  PrinterCapabilities,
  PrinterStatus,
  PrinterResponse,
  MyShopMembership,
} from "./types.js";
