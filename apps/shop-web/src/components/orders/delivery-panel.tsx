"use client";

import { useState, type ReactNode } from "react";
import type { ShopOrderDelivery } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { INPUT } from "@/components/form-kit";
import type { Runner } from "@/components/orders/action-dialogs";
import { useSession } from "@/components/session-provider";
import { Button, Notice, Panel, Pill } from "@/components/ui";
import { getApi } from "@/lib/api";
import {
  formatDateTime,
  formatMoney,
  humanizeEnum,
  minorToInput,
  parseMoneyToMinor,
} from "@/lib/format";
import { nextDeliveryStatuses } from "@/lib/order-actions";

const STATUS_LABELS = {
  OUT_FOR_DELIVERY: "Hand to courier",
  DELIVERED: "Mark delivered",
  FAILED: "Mark failed",
  CANCELLED: "Cancel delivery",
} as const;

/** PRD 71. Everyone who can see the order sees the delivery's status and
 * fee; the ADDRESS is personal data, so the API withholds it (null +
 * `addressRedacted`) from roles without MANAGE_DELIVERY, and this panel
 * says so instead of showing an empty field. Editing and status changes
 * are MANAGE_DELIVERY only. */
export function DeliveryPanel({
  orderId,
  orderStatus,
  delivery,
  currency,
  runner,
}: {
  orderId: string;
  /** A closed order cannot gain a delivery (the API answers DELIVERY_NOT_ALLOWED). */
  orderStatus: string;
  delivery: ShopOrderDelivery | null;
  currency: string;
  runner: Runner;
}): ReactNode {
  const { can } = useSession();
  const canManage = can(Permission.MANAGE_DELIVERY);
  const [editing, setEditing] = useState(false);

  const orderClosed = ["COMPLETED", "CANCELLED", "SHOP_REJECTED", "EXPIRED"].includes(orderStatus);
  if (delivery === null && (!canManage || orderClosed)) {
    return null;
  }
  const closed = delivery !== null && nextDeliveryStatuses(delivery.status).length === 0;

  return (
    <Panel
      title="Delivery"
      id="delivery"
      aside={delivery !== null ? <Pill>{humanizeEnum(delivery.status)}</Pill> : undefined}
    >
      {delivery === null && !editing && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted">This order is for collection: no delivery is set up.</p>
          <Button onClick={() => setEditing(true)} disabled={runner.busy}>
            Add delivery
          </Button>
        </div>
      )}

      {delivery !== null && !editing && (
        <div className="grid gap-3">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-1">
            <div className="sm:col-span-2 xl:col-span-1">
              <dt className="text-xs text-muted">Address</dt>
              <dd>
                {delivery.address !== null ? (
                  delivery.address
                ) : (
                  <span className="text-muted">
                    Hidden for your role. Only staff who manage deliveries can see the address.
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Courier</dt>
              <dd>{delivery.courier ?? <span className="text-muted">Not assigned</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Tracking number</dt>
              <dd className="num">
                {delivery.trackingNumber ?? <span className="text-muted">None</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Delivery fee</dt>
              <dd className="num">{formatMoney(delivery.feeMinor, currency)}</dd>
            </div>
            {delivery.dispatchedAt !== null && (
              <div>
                <dt className="text-xs text-muted">Dispatched</dt>
                <dd>{formatDateTime(delivery.dispatchedAt)}</dd>
              </div>
            )}
            {delivery.deliveredAt !== null && (
              <div>
                <dt className="text-xs text-muted">Delivered</dt>
                <dd>{formatDateTime(delivery.deliveredAt)}</dd>
              </div>
            )}
          </dl>
          {runner.error !== null && (
            <Notice tone="danger" role="alert">
              {runner.error}
            </Notice>
          )}
          {canManage && !closed && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setEditing(true)} disabled={runner.busy}>
                Edit details
              </Button>
              {nextDeliveryStatuses(delivery.status).map((status) => (
                <Button
                  key={status}
                  disabled={runner.busy}
                  onClick={() =>
                    void runner.run(() =>
                      getApi().shopOrders.setDeliveryStatus(orderId, { status }),
                    )
                  }
                >
                  {STATUS_LABELS[status]}
                </Button>
              ))}
            </div>
          )}
          {closed && (
            <p className="text-xs text-muted">This delivery is closed and can no longer change.</p>
          )}
        </div>
      )}

      {editing && canManage && (
        <DeliveryForm
          orderId={orderId}
          delivery={delivery}
          currency={currency}
          runner={runner}
          onDone={() => setEditing(false)}
        />
      )}
    </Panel>
  );
}

function DeliveryForm({
  orderId,
  delivery,
  currency,
  runner,
  onDone,
}: {
  orderId: string;
  delivery: ShopOrderDelivery | null;
  currency: string;
  runner: Runner;
  onDone: () => void;
}): ReactNode {
  const [address, setAddress] = useState(delivery?.address ?? "");
  const [courier, setCourier] = useState(delivery?.courier ?? "");
  const [tracking, setTracking] = useState(delivery?.trackingNumber ?? "");
  const [fee, setFee] = useState(
    delivery === null ? "" : minorToInput(delivery.feeMinor, currency),
  );
  const feeMinor = fee.trim() === "" ? undefined : parseMoneyToMinor(fee, currency);
  const feeInvalid = fee.trim() !== "" && feeMinor === null;
  const addressInvalid = address.trim().length < 5;

  return (
    <form
      className="grid gap-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void runner
          .run(() =>
            getApi().shopOrders.saveDelivery(orderId, {
              address: address.trim(),
              courier: courier.trim() || null,
              trackingNumber: tracking.trim() || null,
              feeMinor: feeMinor ?? undefined,
            }),
          )
          .then((outcome) => outcome === "ok" && onDone());
      }}
    >
      <label className="grid gap-1 font-medium">
        Address
        <textarea
          value={address}
          rows={3}
          maxLength={500}
          onChange={(event) => setAddress(event.target.value)}
          aria-invalid={addressInvalid}
          className={INPUT}
        />
        {addressInvalid && <span className="text-xs text-muted">At least 5 characters.</span>}
      </label>
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
        <label className="grid gap-1 font-medium">
          Courier
          <input
            value={courier}
            maxLength={100}
            onChange={(event) => setCourier(event.target.value)}
            className={INPUT}
          />
        </label>
        <label className="grid gap-1 font-medium">
          Tracking number
          <input
            value={tracking}
            maxLength={100}
            onChange={(event) => setTracking(event.target.value)}
            className={`${INPUT} num`}
          />
        </label>
        <label className="grid gap-1 font-medium">
          Fee, {currency}
          <input
            inputMode="decimal"
            value={fee}
            onChange={(event) => setFee(event.target.value)}
            aria-invalid={feeInvalid}
            className={`${INPUT} num`}
          />
          {feeInvalid && (
            <span className="text-xs text-danger-fg">Enter an amount like 125.50.</span>
          )}
        </label>
      </div>
      {runner.error !== null && (
        <Notice tone="danger" role="alert">
          {runner.error}
        </Notice>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={runner.busy || addressInvalid || feeInvalid}
        >
          {runner.busy ? "Saving…" : "Save delivery"}
        </Button>
        <Button onClick={onDone} disabled={runner.busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
