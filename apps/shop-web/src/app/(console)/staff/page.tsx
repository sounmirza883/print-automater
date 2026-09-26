import type { Metadata } from "next";
import type { ReactNode } from "react";
import { StaffScreen } from "@/components/staff/staff-screen";

export const metadata: Metadata = { title: "Staff" };

export default function StaffPage(): ReactNode {
  return <StaffScreen />;
}
