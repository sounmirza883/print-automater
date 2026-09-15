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
export type {
  AuthTokens,
  AuthUser,
  AuthResult,
  DocumentStatus,
  CreateDocumentResult,
  DocumentStatusView,
} from "./types.js";
