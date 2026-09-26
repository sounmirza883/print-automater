import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SuppliersScreen } from "@/components/suppliers/suppliers-screen";

export const metadata: Metadata = { title: "Suppliers" };

export default function SuppliersPage(): ReactNode {
  return <SuppliersScreen />;
}
