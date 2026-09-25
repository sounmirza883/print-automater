import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PrinterDashboard } from "@/components/dashboard/printer-dashboard";

export const metadata: Metadata = { title: "Printer status" };

export default function PrinterDashboardPage(): ReactNode {
  return <PrinterDashboard />;
}
