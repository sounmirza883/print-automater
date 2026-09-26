import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ProductsScreen } from "@/components/products/products-screen";

export const metadata: Metadata = { title: "Products & pricing" };

export default function ProductsPage(): ReactNode {
  return <ProductsScreen />;
}
