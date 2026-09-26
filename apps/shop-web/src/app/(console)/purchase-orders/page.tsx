import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PurchaseOrdersScreen } from "@/components/purchase-orders/po-screen";

export const metadata: Metadata = { title: "Purchase orders" };

export default function PurchaseOrdersPage(): ReactNode {
  return <PurchaseOrdersScreen />;
}
