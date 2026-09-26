import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PrinterRulesScreen } from "@/components/settings/printer-rules-screen";

export const metadata: Metadata = { title: "Printer rules" };

export default function PrinterRulesPage(): ReactNode {
  return <PrinterRulesScreen />;
}
