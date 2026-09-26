import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SupplierDetail } from "@/components/suppliers/supplier-detail";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  return <SupplierDetail supplierId={id} />;
}
