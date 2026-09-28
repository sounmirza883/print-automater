import { UserRole, type Prisma } from "@prisma/client";

/** 24.1 (QR guest ordering): every platform-wide user view in the admin
 * panel -- the user list, its total, the dashboard's `users` aggregate and
 * the system-status count -- means PEOPLE. A role SYSTEM user is a shop's
 * synthetic QR-order account (Shop.qrSystemUserId), so it is filtered out of
 * all of them with this one shared filter rather than a copy per query. */
export const REAL_USERS = { role: { not: UserRole.SYSTEM } } satisfies Prisma.UserWhereInput;
