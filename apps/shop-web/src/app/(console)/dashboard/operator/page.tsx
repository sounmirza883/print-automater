import type { Metadata } from "next";
import type { ReactNode } from "react";
import { OperatorDashboard } from "@/components/dashboard/operator-dashboard";

export const metadata: Metadata = { title: "Production" };

export default function OperatorDashboardPage(): ReactNode {
  return <OperatorDashboard />;
}
