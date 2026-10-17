import type { HttpClient } from "../http-client.js";

/** A business's physical location. Mirrors services/api's `BranchResponse`. */
export interface BranchSummary {
  id: string;
  shopId: string;
  name: string;
  city: string | null;
  address: string;
  phone: string | null;
  /** The branch's own open/closed switch; the business-level status stays the master gate. */
  isOpen: boolean;
  openingHours: unknown;
  archivedAt: string | null;
  createdAt: string;
  /** People assigned here (active or suspended). */
  staffCount: number;
  /** Active managers assigned here. */
  managers: Array<{ membershipId: string; userId: string; name: string }>;
}

export interface CreateBranchBody {
  name: string;
  city?: string;
  address: string;
  phone?: string;
}

/** Only what is sent changes; `null` clears an optional field. */
export interface UpdateBranchBody {
  name?: string;
  city?: string | null;
  address?: string;
  phone?: string | null;
}

export class BranchesResource {
  constructor(private readonly http: HttpClient) {}

  /** Everyone on staff can read them; a branch-bound person only gets their own. */
  list(shopId: string, params: { includeArchived?: boolean } = {}): Promise<BranchSummary[]> {
    return this.http.request<BranchSummary[]>("/v1/shop/branches", {
      query: {
        shopId,
        ...(params.includeArchived ? { includeArchived: "true" } : {}),
      },
    });
  }

  /** Owners only. */
  create(shopId: string, body: CreateBranchBody): Promise<BranchSummary> {
    return this.http.request<BranchSummary>("/v1/shop/branches", {
      method: "POST",
      body: { shopId, ...body },
    });
  }

  /** Owners only. */
  update(branchId: string, body: UpdateBranchBody): Promise<BranchSummary> {
    return this.http.request<BranchSummary>(`/v1/shop/branches/${branchId}`, {
      method: "PATCH",
      body,
    });
  }

  /** An owner, or the branch's own manager. */
  setOpen(branchId: string, isOpen: boolean): Promise<BranchSummary> {
    return this.http.request<BranchSummary>(`/v1/shop/branches/${branchId}/open-state`, {
      method: "PUT",
      body: { isOpen },
    });
  }

  /** Owners only. Refused (409) while people work there, and for the business's last branch. */
  archive(branchId: string): Promise<BranchSummary> {
    return this.http.request<BranchSummary>(`/v1/shop/branches/${branchId}/archive`, {
      method: "POST",
    });
  }
}
