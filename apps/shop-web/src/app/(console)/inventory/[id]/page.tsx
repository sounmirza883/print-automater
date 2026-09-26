import type { Metadata } from "next";
import type { ReactNode } from "react";
import { InventoryItemScreen } from "@/components/inventory/inventory-item-screen";

export const metadata: Metadata = { title: "Stock item" };

export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  return <InventoryItemScreen itemId={id} />;
}
