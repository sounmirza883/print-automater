"use client";

import { Permission } from "@print-automated/types";
import { useSession } from "@/components/session-provider";
import { getApi } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

/** The business currency for money fields. Only roles that may view
 * settings can read it; everyone else sees the platform default (PKR),
 * which is what a business starts with. Display only: amounts are always
 * integer minor units on the wire. */
export function useCurrency(): string {
  const { business, can } = useSession();
  const shopId = business?.id ?? "";
  const settings = useResource(() => getApi().settings.get(shopId), [shopId], {
    enabled: shopId !== "" && can(Permission.VIEW_SETTINGS),
  });
  return settings.data?.currency ?? "PKR";
}
