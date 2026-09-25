import type { ReactNode } from "react";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";

export default function DashboardLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <DashboardTabs />
      {children}
    </>
  );
}
