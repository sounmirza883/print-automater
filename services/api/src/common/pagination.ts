import type { Page } from "@print-automated/types";
import {
  DEFAULT_PAGE_LIMIT,
  LEGACY_LIST_CAP,
  type OptionalPaginationQueryInput,
} from "@print-automated/validation";

export interface ResolvedPagination {
  /** True when the client sent `limit` and/or `offset` and so wants the envelope. */
  paged: boolean;
  take: number;
  skip: number;
  limit: number;
  offset: number;
}

/** 23.6: turns the optional `?limit=&offset=` into query bounds. A request without either
 * is a LEGACY call (a bare array to clients that predate pagination), still bounded to
 * LEGACY_LIST_CAP rows; with either it is a page (limit default 50, max 100, enforced by
 * the schema). */
export function resolvePagination(query: OptionalPaginationQueryInput): ResolvedPagination {
  const paged = query.limit !== undefined || query.offset !== undefined;
  if (!paged) {
    return { paged, take: LEGACY_LIST_CAP, skip: 0, limit: LEGACY_LIST_CAP, offset: 0 };
  }
  const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
  const offset = query.offset ?? 0;
  return { paged, take: limit, skip: offset, limit, offset };
}

/** The envelope for a paged call, the bare array for a legacy one. `total` is only
 * needed for a page, so callers pass it lazily to avoid a COUNT on legacy calls. */
export function listResult<T>(
  pagination: ResolvedPagination,
  items: T[],
  total: number,
): T[] | Page<T> {
  return pagination.paged
    ? { items, total, limit: pagination.limit, offset: pagination.offset }
    : items;
}
