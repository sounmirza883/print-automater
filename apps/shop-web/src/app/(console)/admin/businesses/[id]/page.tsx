import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BusinessDetail } from "@/components/admin/business-detail";

export const metadata: Metadata = { title: "Business" };

export default async function AdminBusinessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  return <BusinessDetail businessId={id} />;
}
