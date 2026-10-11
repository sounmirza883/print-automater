import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PaymentsScreen } from "@/components/admin/payments-screen";

export const metadata: Metadata = { title: "Payments" };

export default function AdminPaymentsPage(): ReactNode {
  return <PaymentsScreen />;
}
