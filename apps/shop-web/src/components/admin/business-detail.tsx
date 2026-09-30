"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { AdminBusinessDetail } from "@print-automated/api-client";
import type { ShopStatus } from "@print-automated/types";
import { SelectField } from "@/components/form-kit";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  Button,
  ForbiddenState,
  LiveStatus,
  PageHeader,
  Panel,
  Pill,
  Stat,
  StatGrid,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatCount, formatDate, humanizeEnum } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import { STATUS_OPTIONS, STATUS_TONE } from "./businesses-screen";
import { ShopQrCode } from "./shop-qr-code";

/** Workstream A (23.7): one business's detail -- counts of what's
 * actually happening there, its profile, and the one thing an admin can
 * do that the business's own staff cannot: force its status. Same
 * `isAdmin` gate as `BusinessesScreen`, not a per-shop permission. */
export function BusinessDetail({ businessId }: { businessId: string }): ReactNode {
  const { isAdmin } = useSession();
  if (!isAdmin) {
    return <ForbiddenState what="business management" />;
  }
  return <BusinessDetailBody businessId={businessId} />;
}

function BusinessDetailBody({ businessId }: { businessId: string }): ReactNode {
  const state = useResource(() => getApi().admin.getBusiness(businessId), [businessId]);
  return (
    <>
      <p className="mb-3 text-sm">
        <Link href="/admin/businesses" className="underline underline-offset-2">
          &larr; Businesses
        </Link>
      </p>
      <PageHeader
        title={state.data?.name ?? "Business"}
        actions={
          <LiveStatus
            lastUpdated={state.lastUpdated}
            refreshing={state.refreshing}
            onRefresh={state.reload}
          />
        }
      />
      <ResourceBoundary state={state} what="this business">
        {(data) => <BusinessBody data={data} onChanged={state.reload} />}
      </ResourceBoundary>
    </>
  );
}

const QR_NOT_READY_WITHOUT_PRICES =
  "This business has no prices yet, so every order placed through its QR code would be refused. The code appears here once its owner saves a price list (Products & pricing, then Pricing rules).";

/** Fix wave 1: who runs the business, and whether they have set their password
 * yet. An admin-created owner starts with no password and an emailed code; until
 * they use it, the admin can send a fresh code (the old one stops working). */
export function OwnerPanel({
  businessId,
  owner,
  onChanged,
}: {
  businessId: string;
  owner: AdminBusinessDetail["owner"];
  onChanged: () => void;
}): ReactNode {
  const runner = useActionRunner(onChanged);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (owner === null) {
    return (
      <Panel title="Owner" id="owner">
        <p className="text-sm text-muted">
          No owner on record. This business was added before owners were named when a business is
          created.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Owner" id="owner">
      <div className="grid gap-3 text-sm">
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Name</dt>
            <dd>{owner.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Email</dt>
            <dd className="break-all">{owner.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Account</dt>
            <dd>
              {owner.activationPending ? (
                <Pill tone="caution">Activation pending</Pill>
              ) : (
                <Pill tone="good">Active</Pill>
              )}
            </dd>
          </div>
        </dl>
        {owner.activationPending && (
          <>
            <p className="text-muted">
              The owner has not set their password yet. They were emailed a code to use under
              &ldquo;Set up your account&rdquo; on the sign-in page. Codes last 7 days; if it
              expired or never arrived, send a new one (the old code then stops working).
            </p>
            <div>
              <Button
                disabled={runner.busy}
                onClick={() => {
                  setSentTo(null);
                  void runner
                    .run(() => getApi().admin.reissueOwnerInvite(businessId))
                    .then((outcome) => {
                      if (outcome === "ok") setSentTo(owner.email);
                    });
                }}
              >
                {runner.busy ? "Sending…" : "Send a new code"}
              </Button>
            </div>
          </>
        )}
        {sentTo !== null && (
          <p role="status" className="text-good-fg">
            A new code is on its way to {sentTo}. The previous code no longer works.
          </p>
        )}
        {runner.error !== null && (
          <p
            role="alert"
            className="rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-danger-fg"
          >
            {runner.error}
          </p>
        )}
      </div>
    </Panel>
  );
}

function BusinessBody({
  data,
  onChanged,
}: {
  data: AdminBusinessDetail;
  onChanged: () => void;
}): ReactNode {
  const runner = useActionRunner(onChanged);
  const [status, setStatus] = useState<ShopStatus>(data.status);

  return (
    <div className="grid gap-4">
      {runner.error !== null && (
        <p
          role="alert"
          className="rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-danger-fg"
        >
          {runner.error}
        </p>
      )}

      <StatGrid>
        <Stat label="Active staff" value={formatCount(data.counts.staff)} />
        <Stat label="Orders" value={formatCount(data.counts.orders)} />
        <Stat label="Printers" value={formatCount(data.counts.printers)} />
      </StatGrid>

      <Panel title="Profile" id="profile">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Address</dt>
            <dd>{data.address}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Phone</dt>
            <dd>{data.phone ?? "Not set"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Since</dt>
            <dd>{formatDate(data.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">
              Current status
            </dt>
            <dd>
              <Pill tone={STATUS_TONE[data.status] ?? "neutral"}>{humanizeEnum(data.status)}</Pill>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-muted uppercase">Prices</dt>
            <dd>
              {data.hasPricingRule ? (
                <Pill tone="good">Set</Pill>
              ) : (
                <Pill tone="caution">Not set yet</Pill>
              )}
            </dd>
          </div>
        </dl>
      </Panel>

      <OwnerPanel businessId={data.id} owner={data.owner} onChanged={onChanged} />

      {/* Fix wave 1: until the business has a price list, EVERY order to it is refused
          (409 SHOP_PRICING_NOT_CONFIGURED), so the code is withheld rather than handed
          out looking ready. */}
      <ShopQrCode
        shopId={data.id}
        shopName={data.name}
        notReady={data.hasPricingRule ? undefined : QR_NOT_READY_WITHOUT_PRICES}
      />

      <Panel title="Status" id="status">
        <form
          className="grid gap-3 text-sm sm:max-w-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void runner.run(() => getApi().admin.updateBusinessStatus(data.id, status));
          }}
        >
          <SelectField
            label="Status"
            value={status}
            onChange={(value) => setStatus(value as ShopStatus)}
            options={STATUS_OPTIONS}
          />
          <p className="text-xs text-muted">
            This overrides the business&apos;s own open/close setting -- use it to suspend a
            business for abuse, or to reopen one on its behalf.
          </p>
          <div>
            <Button
              type="submit"
              variant="primary"
              disabled={runner.busy || status === data.status}
            >
              {runner.busy ? "Saving…" : "Save status"}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
