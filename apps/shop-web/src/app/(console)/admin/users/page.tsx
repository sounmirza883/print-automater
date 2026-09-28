import type { Metadata } from "next";
import type { ReactNode } from "react";
import { UsersScreen } from "@/components/admin/users-screen";

export const metadata: Metadata = { title: "Users" };

export default function AdminUsersPage(): ReactNode {
  return <UsersScreen />;
}
