import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminDashboard } from "@/components/dashboard/admin-dashboard";

export const metadata: Metadata = { title: "Platform" };

export default function AdminPage(): ReactNode {
  return <AdminDashboard />;
}
