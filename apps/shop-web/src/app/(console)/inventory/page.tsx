import type { Metadata } from "next";
import type { ReactNode } from "react";
import { InventoryScreen } from "@/components/inventory/inventory-screen";

export const metadata: Metadata = { title: "Inventory" };

export default function InventoryPage(): ReactNode {
  return <InventoryScreen />;
}
