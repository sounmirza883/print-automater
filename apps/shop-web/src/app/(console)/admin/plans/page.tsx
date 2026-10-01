import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PlansScreen } from "@/components/admin/plans-screen";

export const metadata: Metadata = { title: "Plans" };

export default function AdminPlansPage(): ReactNode {
  return <PlansScreen />;
}
