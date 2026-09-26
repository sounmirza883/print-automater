import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CustomersScreen } from "@/components/customers/customers-screen";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage(): ReactNode {
  return <CustomersScreen />;
}
