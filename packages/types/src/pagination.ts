/** 23.6: the one paginated-list envelope every list endpoint returns once a client asks
 * for a page (`?limit=&offset=`, limit 1-100, default 50). */
export interface Page<T> {
  items: T[];
  /** Rows matching the filters across all pages. */
  total: number;
  limit: number;
  offset: number;
}
