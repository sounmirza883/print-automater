/** The ONE definition of how many pages a print job consumes: resolved
 * document page count x copies. Used by allocation (maxJobPages and page
 * allowance), the queue-load figures and usage accrual, so they cannot
 * drift. A legacy job with no order item has no copies figure: 1. An
 * unknown page count counts as 1 (the pre-19 convention). */
export function jobPages(
  pageCount: number | null | undefined,
  copies: number | null | undefined,
): number {
  return (pageCount ?? 1) * (copies ?? 1);
}
