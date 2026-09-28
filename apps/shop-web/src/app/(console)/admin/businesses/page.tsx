import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BusinessesScreen } from "@/components/admin/businesses-screen";

export const metadata: Metadata = { title: "Businesses" };

export default function AdminBusinessesPage(): ReactNode {
  return <BusinessesScreen />;
}
