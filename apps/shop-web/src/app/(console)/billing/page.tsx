import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BillingScreen } from "@/components/billing/billing-screen";

export const metadata: Metadata = { title: "Billing" };

export default function BillingPage(): ReactNode {
  return <BillingScreen />;
}
