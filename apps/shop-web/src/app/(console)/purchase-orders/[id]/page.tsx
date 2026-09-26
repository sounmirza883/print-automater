import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PurchaseOrderDetail } from "@/components/purchase-orders/po-detail";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  return <PurchaseOrderDetail orderId={id} />;
}
