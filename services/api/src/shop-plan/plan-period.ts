/** Pure date arithmetic for a business's plan period -- kept free of Prisma so
 * the rules ShopPlanService applies inside its locked transactions are unit
 * testable on their own. */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** There is no stored status column: "is this plan active" is always a live
 * comparison against now. `null` (never activated) reads exactly like expired. */
export function isActiveAt(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() > now.getTime();
}

/** Activate / renew / switch: extends by `days` from the LATER of now or the
 * current expiry, so renewing early adds to what is left instead of discarding it. */
export function extendedExpiry(current: Date | null, now: Date, days: number): Date {
  const base = isActiveAt(current, now) ? current! : now;
  return new Date(base.getTime() + days * DAY_MS);
}

/** Cancel: a still-active plan expires right now. An already-expired (or
 * never-activated) one keeps its existing expiry -- cancelling never moves an
 * expiry forward, so a past date stays the truthful record of when it lapsed. */
export function cancelledExpiry(current: Date | null, now: Date): Date | null {
  return isActiveAt(current, now) ? now : current;
}

/** "1 business is" / "N businesses are" -- for the refused-delete message. */
export function subscriberCountPhrase(count: number): string {
  return count === 1 ? "1 business is" : `${count} businesses are`;
}
