/** §4.7/§42/16.5: platform-admin list routes (`GET /admin/businesses` etc.),
 * mirroring services/api/src/admin/admin.service.ts's own response shapes. */
export interface AdminBusinessResponse {
  id: string;
  name: string;
  address: string;
  status: string;
  createdAt: string;
}

export interface AdminListResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
