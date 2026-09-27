import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { ReportsScreen } from "@/components/reports/reports-screen";
import { LoadingGrid } from "@/components/ui";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage(): ReactNode {
  // The screen reads its state from the URL (useSearchParams), which needs a Suspense boundary.
  return (
    <Suspense fallback={<LoadingGrid label="Loading reports" />}>
      <ReportsScreen />
    </Suspense>
  );
}
