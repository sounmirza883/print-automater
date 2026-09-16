"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import {
  ORDER_PROGRESS_STEPS,
  fetchOrder,
  formatMoney,
  getOrderProgress,
  summarizeConfiguration,
  type OrderListItem,
} from "@/lib/orders";

type State =
  | { phase: "loading" }
  | { phase: "ready"; order: OrderListItem }
  | { phase: "error"; message: string };

/** §27's progress display, in plain language only -- `getOrderProgress`
 * (lib/orders.ts) is the one place any of the 17 internal
 * `OrderStatus` values are read at all; everything below it only ever
 * sees step positions or an already-plain-language message. */
export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): ReactNode {
  const { id } = use(params);
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchOrder(id)
      .then((order) => {
        if (!cancelled) {
          setState({ phase: "ready", order });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            phase: "error",
            message: error instanceof Error ? error.message : "Could not load this order.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      {state.phase === "loading" && <p className="text-gray-600">Loading…</p>}

      {state.phase === "error" && (
        <p role="alert" style={{ color: "var(--color-error)" }}>
          {state.message}
        </p>
      )}

      {state.phase === "ready" && <OrderDetail order={state.order} />}
    </main>
  );
}

function OrderDetail({ order }: { order: OrderListItem }): ReactNode {
  const progress = getOrderProgress(order.orderStatus);

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">{order.publicOrderNumber}</h1>
        <p className="text-gray-600">{order.shopName}</p>
      </div>

      {progress.kind === "steps" ? (
        <ol className="flex flex-col gap-2" aria-label="Order progress">
          {ORDER_PROGRESS_STEPS.map((label, index) => {
            const isDone = index < progress.doneCount;
            const isCurrent = index === progress.currentIndex;
            const marker = isDone ? "✓" : isCurrent ? "●" : "○";
            return (
              <li key={label} className="flex items-center gap-2">
                <span aria-hidden="true">{marker}</span>
                <span className={isDone || isCurrent ? "font-medium" : "text-gray-500"}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p role="status" className="rounded-md border border-gray-300 p-4">
          {progress.text}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-gray-500">Document</dt>
        <dd>{order.documentFilename}</dd>
        <dt className="text-gray-500">Configuration</dt>
        <dd>{summarizeConfiguration(order.printConfiguration)}</dd>
        <dt className="text-gray-500">Total</dt>
        <dd>
          {order.pricingSnapshot?.quote
            ? formatMoney(
                order.pricingSnapshot.quote.totalMinor,
                order.pricingSnapshot.quote.currency,
              )
            : "—"}
        </dd>
        <dt className="text-gray-500">Placed</dt>
        <dd>{new Date(order.createdAt).toLocaleString()}</dd>
      </dl>
    </>
  );
}
