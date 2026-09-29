import type { Metadata } from "next";
import type { ReactNode } from "react";
import { UserDetail } from "@/components/admin/user-detail";

export const metadata: Metadata = { title: "User" };

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  return <UserDetail userId={id} />;
}
