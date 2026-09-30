import type { OrderStatus, PaymentStatus } from "@print-automated/types";
import type { ShopOrderResponse } from "@print-automated/api-client";
import { humanizeEnum } from "@/lib/format";
import type { Tone } from "@/lib/job-status";

export const PAGE_SIZE = 25;

export const ORDER_GROUPS = [
  { id: "needsAttention", label: "Needs attention" },
  { id: "printing", label: "Printing" },
  { id: "ready", label: "Ready" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
] as const;

export type OrderGroupId = (typeof ORDER_GROUPS)[number]["id"];

/** The order screen's whole state, kept in the URL (so a link, a refresh
 * and the browser back button all land where the person was, and the
 * dashboards can deep-link `/orders?group=needsAttention`). */
export interface OrdersQuery {
  group: OrderGroupId | null;
  q: string;
  status: string;
  paymentStatus: string;
  /** yyyy-mm-dd, inclusive. */
  from: string;
  to: string;
  printerId: string;
  operatorId: string;
  customerId: string;
  /** "" or a job priority number as text (0 normal, 10 high, 20 urgent). */
  priority: string;
  /** Zero-based page. */
  page: number;
}

export const EMPTY_QUERY: OrdersQuery = {
  group: null,
  q: "",
  status: "",
  paymentStatus: "",
  from: "",
  to: "",
  printerId: "",
  operatorId: "",
  customerId: "",
  priority: "",
  page: 0,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

interface ParamReader {
  get(name: string): string | null;
}

/** Reads and VALIDATES the URL: a hand-edited or stale link degrades to
 * "that filter is off" instead of sending a request the API rejects. */
export function parseOrdersQuery(params: ParamReader): OrdersQuery {
  const text = (name: string): string => (params.get(name) ?? "").trim();
  const group = text("group");
  const page = Number.parseInt(text("page"), 10);
  const priority = text("priority");
  return {
    group: ORDER_GROUPS.some((option) => option.id === group) ? (group as OrderGroupId) : null,
    q: text("q").slice(0, 100),
    status: text("status"),
    paymentStatus: text("paymentStatus"),
    from: DAY.test(text("from")) ? text("from") : "",
    to: DAY.test(text("to")) ? text("to") : "",
    printerId: UUID.test(text("printerId")) ? text("printerId") : "",
    operatorId: UUID.test(text("operatorId")) ? text("operatorId") : "",
    customerId: UUID.test(text("customerId")) ? text("customerId") : "",
    priority: /^\d{1,4}$/.test(priority) ? priority : "",
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 400) : 0,
  };
}

/** True when any search text or filter is set: the list then comes from
 * the search endpoint (all orders, newest first) instead of one group. */
export function isSearching(query: OrdersQuery): boolean {
  return (
    query.q !== "" ||
    query.status !== "" ||
    query.paymentStatus !== "" ||
    query.from !== "" ||
    query.to !== "" ||
    query.printerId !== "" ||
    query.operatorId !== "" ||
    query.customerId !== "" ||
    query.priority !== ""
  );
}

export function toSearchString(query: OrdersQuery): string {
  const params = new URLSearchParams();
  const entries: Array<[string, string]> = [
    ["group", query.group ?? ""],
    ["q", query.q],
    ["status", query.status],
    ["paymentStatus", query.paymentStatus],
    ["from", query.from],
    ["to", query.to],
    ["printerId", query.printerId],
    ["operatorId", query.operatorId],
    ["customerId", query.customerId],
    ["priority", query.priority],
    ["page", query.page > 0 ? String(query.page) : ""],
  ];
  for (const [key, value] of entries) {
    if (value !== "") {
      params.set(key, value);
    }
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

/** The search endpoint's query, with day-granular bounds made inclusive. */
export function searchParamsFor(query: OrdersQuery): {
  q?: string;
  status?: string;
  paymentStatus?: string;
  from?: string;
  to?: string;
  printerId?: string;
  operatorId?: string;
  customerId?: string;
  priority?: number;
  limit: number;
  offset: number;
} {
  return {
    q: query.q || undefined,
    status: query.status || undefined,
    paymentStatus: query.paymentStatus || undefined,
    from: query.from ? `${query.from}T00:00:00.000Z` : undefined,
    to: query.to ? `${query.to}T23:59:59.999Z` : undefined,
    printerId: query.printerId || undefined,
    operatorId: query.operatorId || undefined,
    customerId: query.customerId || undefined,
    priority: query.priority === "" ? undefined : Number(query.priority),
    limit: PAGE_SIZE,
    offset: query.page * PAGE_SIZE,
  };
}

export const ORDER_STATUS_OPTIONS: OrderStatus[] = [
  "WAITING_FOR_SHOP",
  "SHOP_ACCEPTED",
  "QUEUED_FOR_PRINT",
  "PREPARING",
  "ASSIGNED",
  "PRINTING",
  "PAUSED",
  "PRINTED",
  "QUALITY_CHECK",
  "READY_FOR_COLLECTION",
  "COMPLETED",
  "PRINT_FAILED",
  "PRINT_STATUS_UNKNOWN",
  "SHOP_REJECTED",
  "CANCELLED",
  "PAYMENT_PENDING",
  "PAID",
];

export const PAYMENT_STATUS_OPTIONS: PaymentStatus[] = [
  "PENDING",
  "AUTHORIZED",
  "PAID",
  "FAILED",
  "CANCELLED",
  "REFUND_PENDING",
  "REFUNDED",
  "REFUND_FAILED",
];

export function orderStatusTone(status: string): Tone {
  switch (status) {
    case "PRINT_FAILED":
    case "PRINT_STATUS_UNKNOWN":
    case "SHOP_REJECTED":
    case "PAYMENT_FAILED":
      return "danger";
    case "WAITING_FOR_SHOP":
    case "PAUSED":
    case "QUALITY_CHECK":
      return "caution";
    case "PRINTING":
    case "ASSIGNED":
    case "PREPARING":
    case "QUEUED_FOR_PRINT":
    case "SHOP_ACCEPTED":
      return "accent";
    case "PRINTED":
    case "READY_FOR_COLLECTION":
    case "COMPLETED":
      return "good";
    default:
      return "neutral";
  }
}

/** 24.1 + fix wave 1: a guest's QR order has no payment step of its own -- it rests in
 * UPLOADED (which the API shows staff only for QR orders, in needs attention) until
 * someone takes payment at the counter and records it. "Uploaded" alone reads like an
 * order still mid-checkout, so such an order also carries this label. Same rule as
 * availableOrderActions' own QR case in @print-automated/api-client, which offers
 * "Record payment" for exactly these orders. */
export const QR_AWAITING_PAYMENT_LABEL = "QR — awaiting payment";

export function isQrAwaitingPayment(
  order: Pick<ShopOrderResponse, "orderStatus" | "creationSource">,
): boolean {
  return order.orderStatus === "UPLOADED" && order.creationSource === "QR";
}

export function paymentStatusTone(status: string): Tone {
  switch (status) {
    case "PAID":
      return "good";
    case "FAILED":
    case "REFUND_FAILED":
      return "danger";
    case "PENDING":
    case "AUTHORIZED":
    case "REFUND_PENDING":
      return "caution";
    default:
      return "neutral";
  }
}

/** The distinct reasons this order's live jobs are parked, in job order:
 * what a "needs attention" row explains. */
export function blockedReasonsOf(order: Pick<ShopOrderResponse, "printJobs">): string[] {
  const reasons: string[] = [];
  for (const job of order.printJobs) {
    if (job.blockedReason !== null && !reasons.includes(job.blockedReason)) {
      reasons.push(job.blockedReason);
    }
  }
  return reasons;
}

/** "A4 · Colour · Double-sided · 2 copies" for a row. Tolerates the
 * loosely-typed snapshot the API stores (never throws on odd data). */
export function configurationSummary(config: ShopOrderResponse["printConfiguration"]): string {
  if (typeof config !== "object" || config === null) {
    return "";
  }
  const parts = [config.paperSize, config.color, config.sides]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .map(humanizeEnum);
  if (typeof config.copies === "number") {
    parts.push(`${config.copies} ${config.copies === 1 ? "copy" : "copies"}`);
  }
  return parts.join(" · ");
}
