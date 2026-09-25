import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PlannedScreen } from "@/components/planned-screen";
import { NAV_ITEMS } from "@/lib/nav";

/** Every console section that has no concrete page yet lands here, so
 * the navigation shell is complete and permission-checked from day one.
 * A concrete route (`app/(console)/dashboard/page.tsx`, ...) always wins
 * over this catch-all, so building a section means adding its folder --
 * nothing here changes. Unknown sections are a real 404. */
export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}): Promise<ReactNode> {
  const { section } = await params;
  const item = NAV_ITEMS.find((candidate) => candidate.href === `/${section}`);
  if (item === undefined) {
    notFound();
  }
  return <PlannedScreen itemId={item.id} />;
}
