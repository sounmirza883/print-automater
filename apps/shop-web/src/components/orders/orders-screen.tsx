"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ShopOrderResponse } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { BlockedNote } from "@/components/blocked-note";
import { QrAwaitingPaymentPill } from "@/components/orders/action-bars";
import { OperatorPicker } from "@/components/orders/operator-picker";
import { RequirePermission } from "@/components/resource-boundary";
import { INPUT } from "@/components/form-kit";
import { useSession } from "@/components/session-provider";
import { Tabs } from "@/components/tabs";
import {
  Button,
  EmptyState,
  ErrorState,
  LiveStatus,
  LoadingGrid,
  PageHeader,
  Pill,
  StaleBanner,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { errorCodeOf } from "@/lib/error-copy";
import { formatAge, formatMoney, humanizeEnum } from "@/lib/format";
import {
  EMPTY_QUERY,
  ORDER_GROUPS,
  ORDER_STATUS_OPTIONS,
  PAGE_SIZE,
  PAYMENT_STATUS_OPTIONS,
  activeFilterCount,
  blockedReasonsOf,
  configurationSummary,
  isSearching,
  orderStatusTone,
  parseOrdersQuery,
  paymentStatusTone,
  searchParamsFor,
  toSearchString,
  type OrdersQuery,
} from "@/lib/orders-view";
import { useResource } from "@/lib/use-resource";

const POLL_MS = 30_000;

/** PRD 110: the queue. The five groups the API defines (needs attention
 * first, and visibly so), plus search and filters over every order. The
 * whole state lives in the URL, so a dashboard link, a refresh and the
 * back button all land in the same place. */
export function OrdersScreen(): ReactNode {
  return (
    <RequirePermission permission={Permission.VIEW_ORDERS} what="orders">
      <OrdersBody />
    </RequirePermission>
  );
}

function OrdersBody(): ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const { business, branchFilter, showBranchColumn } = useSession();
  const shopId = business?.id ?? "";
  const query = parseOrdersQuery(params);
  const searching = isSearching(query);
  const [draft, setDraft] = useState<OrdersQuery>(query);
  // The URL is the source of truth and the form is a draft of it. When the URL
  // changes from outside this form (the search palette, the back button, a link
  // from the dashboard), the draft follows; otherwise the next Search would send
  // the form's old text and silently drop what the URL was showing.
  const urlKey = toSearchString(query);
  const [syncedKey, setSyncedKey] = useState(urlKey);
  // Phone only: below `sm` the filter fields fold away behind a Filters button.
  // A search by text alone does not need them open; a filter that is set does.
  // Declared before the sync block below, which may open it.
  const [filtersOpen, setFiltersOpen] = useState(activeFilterCount(query) > 0);
  if (syncedKey !== urlKey) {
    setSyncedKey(urlKey);
    setDraft(query);
    if (activeFilterCount(query) > 0) {
      setFiltersOpen(true);
    }
  }
  const [showMore, setShowMore] = useState(
    query.printerId !== "" || query.operatorId !== "" || query.customerId !== "",
  );

  const go = (next: OrdersQuery): void => {
    router.replace(`/orders${toSearchString(next)}`);
  };

  // The selected branch narrows the queue, the search and the printer filter alike. Changing it
  // starts the list over: a page number or a printer chosen for one branch means nothing at
  // another (page 3 of a shorter list would be empty, with no pager to get back).
  const lastBranch = useRef(branchFilter);
  useEffect(() => {
    if (lastBranch.current === branchFilter) {
      return;
    }
    lastBranch.current = branchFilter;
    if (query.page > 0 || query.printerId !== "") {
      // (The search form follows the URL, so its printer field clears with it.)
      go({ ...query, printerId: "", page: 0 });
    }
    // Only a change of branch should reset; `query` and `go` are read as they are at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchFilter]);

  const state = useResource(
    () =>
      searching
        ? getApi().shopOrders.search(shopId, {
            ...searchParamsFor(query),
            branchId: branchFilter,
          })
        : getApi().shopOrders.listPage(shopId, {
            group: query.group ?? undefined,
            branchId: branchFilter,
            limit: PAGE_SIZE,
            offset: query.page * PAGE_SIZE,
          }),
    [shopId, branchFilter, toSearchString(query)],
    // Plain listing is never throttled and is what a floor screen watches;
    // searches draw on a 60/minute budget so they are run on demand only.
    { intervalMs: searching ? undefined : POLL_MS, enabled: shopId !== "" },
  );

  // For the printer filter (every staff role may read the printer list since 23.14).
  const printers = useResource(
    () => getApi().printers.listPage(shopId, { limit: 100, branchId: branchFilter }),
    [shopId, branchFilter],
    { enabled: shopId !== "" },
  );

  function submitSearch(event: FormEvent): void {
    event.preventDefault();
    go({ ...draft, group: query.group, page: 0 });
  }

  const items = state.data?.items ?? [];
  const total = state.data?.total ?? 0;
  const rateLimited = errorCodeOf(state.error) === "RATE_LIMITED";

  return (
    <>
      <PageHeader
        title="Orders and queue"
        subtitle={business?.name}
        actions={
          <LiveStatus
            lastUpdated={state.lastUpdated}
            refreshing={state.refreshing}
            onRefresh={state.reload}
          />
        }
      />

      <Tabs
        ariaLabel="Order groups"
        activeId={searching ? null : (query.group ?? "all")}
        items={[
          { id: "all", label: "All" },
          ...ORDER_GROUPS.map((group) => ({
            id: group.id,
            label: group.label,
            emphasis: group.id === "needsAttention",
          })),
        ]}
        onSelect={(id) => {
          setDraft(EMPTY_QUERY);
          const group = ORDER_GROUPS.find((candidate) => candidate.id === id);
          go(group === undefined ? EMPTY_QUERY : { ...EMPTY_QUERY, group: group.id });
        }}
      />

      <form
        onSubmit={submitSearch}
        role="search"
        aria-label="Search orders"
        className="mb-4 grid gap-3 rounded-lg border border-line bg-panel p-3"
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-[14rem] flex-1 gap-1 text-xs font-medium text-muted">
            Search order number, customer or document
            <input
              type="search"
              value={draft.q}
              maxLength={100}
              onChange={(event) => setDraft({ ...draft, q: event.target.value })}
              className={INPUT}
            />
          </label>
          {/* Phone: Search and Filters sit beside the search box, and everything else
              folds away until Filters is pressed. From `sm` up the wrapper is
              display:contents, so the controls flow in one row exactly as they always
              did; the desktop Search button then sits after Priority, and this phone
              copy is display:none (out of the tab order and the accessibility tree). */}
          <span className="contents sm:hidden">
            <Button type="submit" variant="primary">
              Search
            </Button>
          </span>
          <button
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
            className="inline-flex min-h-11 items-center rounded-md border border-line bg-panel px-3 text-sm font-medium sm:hidden"
          >
            {filtersOpen
              ? "Hide filters"
              : activeFilterCount(query) > 0
                ? `Filters (${activeFilterCount(query)})`
                : "Filters"}
          </button>
          <div
            className={`${filtersOpen ? "flex" : "hidden"} basis-full flex-wrap items-end gap-3 sm:contents`}
          >
            <label className="grid gap-1 text-xs font-medium text-muted">
              Status
              <select
                value={draft.status}
                onChange={(event) => setDraft({ ...draft, status: event.target.value })}
                className={INPUT}
              >
                <option value="">Any</option>
                {ORDER_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {humanizeEnum(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted">
              Payment
              <select
                value={draft.paymentStatus}
                onChange={(event) => setDraft({ ...draft, paymentStatus: event.target.value })}
                className={INPUT}
              >
                <option value="">Any</option>
                {PAYMENT_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {humanizeEnum(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted">
              From
              <input
                type="date"
                value={draft.from}
                onChange={(event) => setDraft({ ...draft, from: event.target.value })}
                className={INPUT}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted">
              To
              <input
                type="date"
                value={draft.to}
                onChange={(event) => setDraft({ ...draft, to: event.target.value })}
                className={INPUT}
              />
            </label>
            <label className="grid gap-1 text-xs font-medium text-muted">
              Priority
              <select
                value={draft.priority}
                onChange={(event) => setDraft({ ...draft, priority: event.target.value })}
                className={INPUT}
              >
                <option value="">Any</option>
                <option value="0">Normal</option>
                <option value="10">High</option>
                <option value="20">Urgent</option>
              </select>
            </label>
            <span className="contents max-sm:hidden">
              <Button type="submit" variant="primary">
                Search
              </Button>
            </span>
            {(searching || isSearching(draft)) && (
              <Button
                onClick={() => {
                  setDraft(EMPTY_QUERY);
                  go({ ...EMPTY_QUERY, group: query.group });
                }}
              >
                Clear
              </Button>
            )}
            <button
              type="button"
              aria-expanded={showMore}
              onClick={() => setShowMore(!showMore)}
              className="text-sm font-medium underline"
            >
              {showMore ? "Fewer filters" : "More filters"}
            </button>
            {showMore && (
              <div className="flex basis-full flex-wrap items-end gap-3">
                {printers.data !== null && (
                  <label className="grid gap-1 text-xs font-medium text-muted">
                    Printer
                    <select
                      value={draft.printerId}
                      onChange={(event) => setDraft({ ...draft, printerId: event.target.value })}
                      className={INPUT}
                    >
                      <option value="">Any</option>
                      {printers.data.items.map((printer) => (
                        <option key={printer.id} value={printer.id}>
                          {printer.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <OperatorPicker
                  shopId={shopId}
                  label="Operator"
                  value={draft.operatorId}
                  onChange={(value) => setDraft({ ...draft, operatorId: value })}
                  emptyLabel="Any"
                  className={INPUT}
                  labelClassName="grid gap-1 text-xs font-medium text-muted"
                />
                <UuidField
                  label="Customer ID"
                  value={draft.customerId}
                  onChange={(value) => setDraft({ ...draft, customerId: value })}
                />
              </div>
            )}
          </div>
        </div>
        {searching && (
          <p className="text-xs text-muted">
            Showing search results across all groups, newest first.
          </p>
        )}
      </form>

      {state.data === null ? (
        state.error !== null ? (
          <>
            {rateLimited && (
              <p role="status" className="mb-3 text-sm text-caution-fg">
                Search is rate limited for a moment; your filters are kept.
              </p>
            )}
            <ErrorState error={state.error} onRetry={state.reload} what="orders" />
          </>
        ) : (
          <LoadingGrid label="Loading orders" />
        )
      ) : (
        <>
          <StaleBanner error={state.error} lastUpdated={state.lastUpdated} onRetry={state.reload} />
          {items.length === 0 ? (
            <EmptyState
              title={
                searching
                  ? "No orders match"
                  : query.group === "needsAttention"
                    ? "Nothing needs attention"
                    : "No orders here"
              }
            >
              {searching
                ? "Try fewer filters or a different search."
                : "Orders appear here as customers place them."}
            </EmptyState>
          ) : (
            <ul className="grid gap-2" aria-label="Orders">
              {items.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  emphasis={query.group === "needsAttention" && !searching}
                  showBranch={showBranchColumn}
                />
              ))}
            </ul>
          )}
          {total > PAGE_SIZE && (
            <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm">
              <Button
                disabled={query.page === 0}
                onClick={() => go({ ...query, page: query.page - 1 })}
              >
                Newer
              </Button>
              <span className="num text-muted">
                {query.page * PAGE_SIZE + 1}&ndash;
                {Math.min((query.page + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <Button
                disabled={(query.page + 1) * PAGE_SIZE >= total}
                onClick={() => go({ ...query, page: query.page + 1 })}
              >
                Older
              </Button>
            </nav>
          )}
        </>
      )}
    </>
  );
}

function UuidField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value.trim())}
        placeholder="paste an ID"
        spellCheck={false}
        className={`${INPUT} num w-72`}
      />
    </label>
  );
}

function OrderRow({
  order,
  emphasis,
  showBranch,
}: {
  order: ShopOrderResponse;
  emphasis: boolean;
  /** True while looking at all of several branches: each order then says where it was placed. */
  showBranch: boolean;
}): ReactNode {
  const reasons = blockedReasonsOf(order);
  const quote = order.pricingSnapshot?.quote;
  return (
    <li
      className={`grid gap-2 rounded-lg border bg-panel px-4 py-3 ${
        emphasis || reasons.length > 0 ? "border-caution/60" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          href={`/orders/${encodeURIComponent(order.id)}`}
          className="num font-semibold underline-offset-2 hover:underline"
        >
          {order.publicOrderNumber}
        </Link>
        <Pill tone={orderStatusTone(order.orderStatus)}>{humanizeEnum(order.orderStatus)}</Pill>
        <Pill tone={paymentStatusTone(order.paymentStatus)}>
          Payment: {humanizeEnum(order.paymentStatus)}
        </Pill>
        <QrAwaitingPaymentPill order={order} />
        {order.printJobs.some((job) => job.blockedReason === "MANUAL_APPROVAL_REQUIRED") && (
          <Pill tone="danger">Held by late print</Pill>
        )}
        {showBranch && order.branchName !== undefined && (
          <span className="text-xs font-medium text-muted">Branch: {order.branchName}</span>
        )}
        <span className="ml-auto text-xs text-muted">{formatAge(order.createdAt)}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-0.5 text-sm">
        <span className="font-medium">{order.customerName}</span>
        <span className="truncate text-muted" title={order.documentFilename}>
          {order.documentFilename}
        </span>
        <span className="text-xs text-muted">{configurationSummary(order.printConfiguration)}</span>
        {quote !== undefined && (
          <span className="num ml-auto">{formatMoney(quote.totalMinor, quote.currency)}</span>
        )}
      </div>
      {order.printerName !== null && (
        <p className="text-xs text-muted">Printer: {order.printerName}</p>
      )}
      {reasons.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {reasons.map((reason) => (
            <BlockedNote key={reason} reason={reason} />
          ))}
        </div>
      )}
    </li>
  );
}
