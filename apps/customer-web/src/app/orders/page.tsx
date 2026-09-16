"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { fetchOrders, formatMoney, summarizeConfiguration, type OrderListItem } from "@/lib/orders";

type State =
  | { phase: "loading" }
  | { phase: "ready"; orders: OrderListItem[] }
  | { phase: "error"; message: string };

/** §28's history list. Documents aren't perpetually downloadable
 * (retention governs, Phase 11), but the order row itself -- and
 * everything this list shows -- is kept regardless: order number,
 * shop, date, amount, status, document name, and configuration
 * summary all come from the order/shop/document rows, none of which
 * retention ever removes (only a document's stored bytes go away). */
export default function OrdersPage(): ReactNode {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchOrders()
      .then((orders) => {
        if (!cancelled) {
          setState({ phase: "ready", orders });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            phase: "error",
            message: error instanceof Error ? error.message : "Could not load your orders.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-bold">Your orders</h1>

      {state.phase === "loading" && <p className="text-gray-600">Loading…</p>}

      {state.phase === "error" && (
        <p role="alert" style={{ color: "var(--color-error)" }}>
          {state.message}
        </p>
      )}

      {state.phase === "ready" && state.orders.length === 0 && (
        <p className="text-gray-600">You haven&apos;t placed any orders yet.</p>
      )}

      {state.phase === "ready" && state.orders.length > 0 && (
        <ul className="flex flex-col gap-3">
          {state.orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/orders/${order.id}`}
                className="block rounded-lg border border-gray-300 p-4 hover:border-gray-400"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{order.publicOrderNumber}</span>
                  <span>
                    {order.pricingSnapshot?.quote
                      ? formatMoney(
                          order.pricingSnapshot.quote.totalMinor,
                          order.pricingSnapshot.quote.currency,
                        )
                      : "—"}
                  </span>
                </div>
                <p className="text-sm text-gray-600">{order.shopName}</p>
                <p className="text-sm text-gray-600">{order.documentFilename}</p>
                <p className="text-sm text-gray-600">
                  {summarizeConfiguration(order.printConfiguration)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {new Date(order.createdAt).toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
