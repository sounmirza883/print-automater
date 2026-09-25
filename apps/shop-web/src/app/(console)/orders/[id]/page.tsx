import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { OrderDetail } from "@/components/orders/order-detail";
import { LoadingGrid } from "@/components/ui";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  // useSearchParams() (the ?job= deep link) needs a Suspense boundary.
  return (
    <Suspense fallback={<LoadingGrid label="Loading order" />}>
      <OrderDetail orderId={id} />
    </Suspense>
  );
}
