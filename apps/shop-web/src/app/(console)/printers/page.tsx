import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PrintersScreen } from "@/components/printers/printers-screen";

export const metadata: Metadata = { title: "Printers" };

export default function PrintersPage(): ReactNode {
  return <PrintersScreen />;
}
