/** Grows one entry per phase, as each phase's own actions come into
 * existence -- §83 lists the full eventual vocabulary, but most of it
 * (ORDER_CREATED, PRINT_STARTED, ...) names features that don't exist
 * yet. record() accepts any string; this is just autocomplete for the
 * actions this phase actually produces. */
export const AuditAction = {
  REGISTER: "REGISTER",
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
