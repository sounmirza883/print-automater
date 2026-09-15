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
