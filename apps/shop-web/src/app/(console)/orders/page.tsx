import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { OrdersScreen } from "@/components/orders/orders-screen";
import { LoadingGrid } from "@/components/ui";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage(): ReactNode {
  // useSearchParams() needs a Suspense boundary.
  return (
    <Suspense fallback={<LoadingGrid label="Loading orders" />}>
      <OrdersScreen />
    </Suspense>
  );
}
