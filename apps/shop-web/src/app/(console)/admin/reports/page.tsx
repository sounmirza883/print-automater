import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PaymentReportScreen } from "@/components/admin/payment-report-screen";

export const metadata: Metadata = { title: "Payment reports" };

export default function AdminReportsPage(): ReactNode {
  return <PaymentReportScreen />;
}
