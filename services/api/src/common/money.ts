/** 23.10: money is never summed across currencies. A figure set is computed per currency and
 * ONE currency is reported: the caller's explicit choice, else the one with the most money in
 * the period, else `fallback` (the shop's configured currency). Ties resolve to `fallback`,
 * then alphabetically, so the answer is deterministic. */
export function pickCurrency(
  totals: ReadonlyArray<{ currency: string; amount: number }>,
  requested: string | undefined,
  fallback: string,
): string {
  if (requested) {
    return requested;
  }
  const byCurrency = new Map<string, number>();
  for (const { currency, amount } of totals) {
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount);
  }
  let best: { currency: string; amount: number } | undefined;
  for (const [currency, amount] of [...byCurrency.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (
      !best ||
      amount > best.amount ||
      (amount === best.amount && currency === fallback && best.currency !== fallback)
    ) {
      best = { currency, amount };
    }
  }
  return best?.currency ?? fallback;
}
