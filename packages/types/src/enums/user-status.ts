/** Mirrors services/api/prisma/schema.prisma's UserStatus enum exactly --
 * the two MUST stay in sync. Task 2 (Workstream B, admin panel user
 * management) is the first place a client needs this value at all (an
 * admin's status-change dropdown and its response shape); every other
 * caller before this only ever compared against the Prisma-generated
 * enum server-side. */
export const UserStatus = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  DELETED: "DELETED",
} as const;

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
