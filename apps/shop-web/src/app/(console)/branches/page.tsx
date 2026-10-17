import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BranchesScreen } from "@/components/branches/branches-screen";

export const metadata: Metadata = { title: "Branches" };

export default function BranchesPage(): ReactNode {
  return <BranchesScreen />;
}
