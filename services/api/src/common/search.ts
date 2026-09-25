/** 23.6: search terms reach Postgres as bound parameters (never concatenated into SQL),
 * but `%` and `_` inside a bound LIKE/ILIKE pattern are still wildcards, and Prisma's
 * `contains` does not escape them: an unescaped "%" would match every row. Escape them so
 * a search term always means exactly what the user typed. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => "\\" + char);
}

/** A case-insensitive "contains" filter for a Prisma string column. */
export function ilike(term: string): { contains: string; mode: "insensitive" } {
  return { contains: escapeLike(term), mode: "insensitive" };
}
