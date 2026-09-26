import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PrinterDetail } from "@/components/printers/printer-detail";

export const metadata: Metadata = { title: "Printer" };

export default async function PrinterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  return <PrinterDetail printerId={id} />;
}
