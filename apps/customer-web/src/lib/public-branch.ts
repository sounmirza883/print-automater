import { publicApiUrl } from "./public-api";

/** A branch as the API's public route `GET /v1/public/shops/:shopId/branches/:branchId` gives it:
 * what a guest who scanned that branch's QR code needs to see. */
export interface PublicBranch {
  id: string;
  name: string;
  city: string | null;
  address: string;
  isOpen: boolean;
}

/** `none`: the link names no branch. `loading`: asking the API. `found`: a branch to order from
 * (open or closed). `unknown`: the API has no such branch. `archived`: the branch existed and was
 * archived, so its printed QR code no longer takes orders. `unreachable`: no usable answer (offline,
 * limited, a failure). */
export type BranchLookup =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "found"; branch: PublicBranch }
  | { kind: "unknown" }
  | { kind: "archived" }
  | { kind: "unreachable" };

// The shape the API checks a branch id against (z.string().uuid()): anything else would be refused
// with a 400 if it were sent in an order, so it is never sent.
const BRANCH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The branch a QR code names, from the page's `?branch=` parameter. Missing, repeated or
 * not-an-id values are ignored: the order then goes to the business's oldest branch, which is what
 * a code printed before branches existed does. */
export function parseBranchParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
  const trimmed = value?.trim();
  return trimmed !== undefined && BRANCH_ID.test(trimmed) ? trimmed : undefined;
}

function isPublicBranch(value: unknown): value is PublicBranch {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.isOpen === "boolean"
  );
}

/** Never throws: the page must still work when this lookup cannot be made. The API's own order
 * checks (open, not archived, this business) are the authority; this only lets the guest see where
 * they are ordering, and stops them wasting an upload on a branch that is closed. */
export async function fetchPublicBranch(
  shopId: string,
  branchId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BranchLookup> {
  try {
    // The wizard waits for this, so a connection that hangs must not hold the guest up for long.
    const response = await fetchImpl(
      publicApiUrl(`/v1/public/shops/${shopId}/branches/${branchId}`),
      { signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(8000) : undefined },
    );
    if (response.status === 404) {
      return { kind: "unknown" };
    }
    // Gone: this business's own branch, archived. Never treated as "unknown", which would quietly
    // send the guest's order to a different branch.
    if (response.status === 410) {
      return { kind: "archived" };
    }
    if (!response.ok) {
      return { kind: "unreachable" };
    }
    const body: unknown = await response.json();
    return isPublicBranch(body)
      ? {
          kind: "found",
          branch: {
            id: body.id,
            name: body.name,
            city: typeof body.city === "string" ? body.city : null,
            address: typeof body.address === "string" ? body.address : "",
            isOpen: body.isOpen,
          },
        }
      : { kind: "unreachable" };
  } catch {
    return { kind: "unreachable" };
  }
}

/** The `branchId` the order carries. A branch the API does not know is dropped (the server then
 * uses the oldest branch); one that merely could not be checked is kept, so a failed lookup never
 * reroutes an order. */
export function orderBranchId(
  branchId: string | undefined,
  lookup: BranchLookup,
): string | undefined {
  return lookup.kind === "unknown" ? undefined : branchId;
}

/** `closed` and `gone` stop the wizard: a closed branch takes no orders right now, and an archived
 * branch never will again, so the guest is told so up front. */
export function branchStage(lookup: BranchLookup): "loading" | "closed" | "gone" | "ready" {
  if (lookup.kind === "loading") return "loading";
  if (lookup.kind === "archived") return "gone";
  if (lookup.kind === "found" && !lookup.branch.isOpen) return "closed";
  return "ready";
}
