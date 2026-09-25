import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DashboardHome } from "@/components/dashboard/dashboard-home";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage(): ReactNode {
  return <DashboardHome />;
}
