"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { AdminBusinessCreated } from "@print-automated/api-client";
import { ShopStatus } from "@print-automated/types";
import { CheckField, Pager, TextField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  Button,
  DataTable,
  EmptyState,
  ForbiddenState,
  LiveStatus,
  PageHeader,
  Panel,
  Pill,
  type Tone,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import {
  CAPABILITY_OPTIONS,
  EMPTY_BUSINESS_FORM,
  businessFormProblems,
  toCreateBusinessInput,
  type BusinessForm,
} from "@/lib/business-form";
import { formatDate, humanizeEnum } from "@/lib/format";
import { useResource } from "@/lib/use-resource";

const PAGE = 25;

/** Shared with `business-detail.tsx`: a business's status has no
 * per-shop role behind it, so this is the one place that decides how
 * each `ShopStatus` reads (tone + label). */
export const STATUS_TONE: Record<string, Tone> = {
  [ShopStatus.OPEN]: "good",
  [ShopStatus.BUSY]: "accent",
  [ShopStatus.CLOSED]: "neutral",
  [ShopStatus.TEMPORARILY_UNAVAILABLE]: "caution",
  [ShopStatus.SUSPENDED]: "danger",
};

export const STATUS_OPTIONS = Object.values(ShopStatus).map((value) => ({
  value,
  label: humanizeEnum(value),
}));

/** Workstream A (23.7): every business on the platform, ADMIN only. The
 * API answers 403 to anyone else; this just avoids asking, the same
 * pattern `AdminDashboard` already uses for `isAdmin`. */
export function BusinessesScreen(): ReactNode {
  const { isAdmin } = useSession();
  if (!isAdmin) {
    return <ForbiddenState what="business management" />;
  }
  return <BusinessesBody />;
}

function BusinessesBody(): ReactNode {
  const [page, setPage] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [created, setCreated] = useState<AdminBusinessCreated | null>(null);
  const list = useResource(
    () => getApi().admin.listBusinesses({ limit: PAGE, offset: page * PAGE }),
    [page],
    { intervalMs: 60_000 },
  );

  return (
    <>
      <PageHeader
        title="Businesses"
        subtitle="Every shop on the platform"
        actions={
          <>
            <LiveStatus
              lastUpdated={list.lastUpdated}
              refreshing={list.refreshing}
              onRefresh={list.reload}
            />
            <Button variant="primary" onClick={() => setDialogOpen(true)}>
              Add a business
            </Button>
          </>
        }
      />
      {created !== null && (
        <BusinessCreatedNotice created={created} onDismiss={() => setCreated(null)} />
      )}
      <ResourceBoundary state={list} what="businesses">
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title="No businesses yet">
              Add the first one to get a shop onto the platform.
            </EmptyState>
          ) : (
            <Panel>
              <DataTable caption="Businesses" head={["Name", "Address", "Status", "Since"]}>
                {data.items.map((business) => (
                  <tr key={business.id}>
                    <td className="px-4 py-2 font-medium">
                      <Link
                        href={`/admin/businesses/${business.id}`}
                        className="underline underline-offset-2"
                      >
                        {business.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted">{business.address}</td>
                    <td className="px-4 py-2">
                      <Pill tone={STATUS_TONE[business.status] ?? "neutral"}>
                        {humanizeEnum(business.status)}
                      </Pill>
                    </td>
                    <td className="px-4 py-2 text-muted">{formatDate(business.createdAt)}</td>
                  </tr>
                ))}
              </DataTable>
              <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
            </Panel>
          )
        }
      </ResourceBoundary>
      {dialogOpen && (
        <CreateBusinessDialog
          onClose={() => setDialogOpen(false)}
          onCreated={(business) => {
            setCreated(business);
            setPage(0);
            list.reload();
          }}
        />
      )}
    </>
  );
}

/** Fix wave 1: there is no password to hand the new owner -- they were emailed
 * a code to set their own -- so this says exactly that, and where they use it. */
export function BusinessCreatedNotice({
  created,
  onDismiss,
}: {
  created: AdminBusinessCreated;
  onDismiss: () => void;
}): ReactNode {
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-md border border-good/50 bg-good-soft px-3 py-2"
    >
      <div className="grid gap-1 text-sm">
        <p className="font-medium">
          Added{" "}
          <Link href={`/admin/businesses/${created.id}`} className="underline underline-offset-2">
            {created.name}
          </Link>
          .
        </p>
        <p>
          We emailed {created.owner.name} at{" "}
          <span className="font-medium">{created.owner.email}</span> an activation code. They choose
          &ldquo;Set up your account&rdquo; on the back office sign-in page, enter that code and
          pick their own password. The code works for 7 days; you can send a new one from the
          business&apos;s page.
        </p>
      </div>
      <Button onClick={onDismiss}>Dismiss</Button>
    </div>
  );
}

/** Fix wave 1: an admin creates the business AND names its owner. There is no
 * password here on purpose: the API creates the owner's account without one
 * and emails them a code to choose their own ("Set up your account" on the
 * sign-in page), so the admin never knows it. The result says so plainly. */
function CreateBusinessDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (created: AdminBusinessCreated) => void;
}): ReactNode {
  const runner = useActionRunner(noop);
  const [form, setForm] = useState<BusinessForm>(EMPTY_BUSINESS_FORM);
  const [touched, setTouched] = useState(false);
  const problems = businessFormProblems(form);
  const shown = (key: keyof typeof problems): string | null =>
    touched ? (problems[key] ?? null) : null;
  const set =
    (key: Exclude<keyof BusinessForm, "capabilities">) =>
    (value: string): void =>
      setForm((current) => ({ ...current, [key]: value }));

  return (
    <FormDialog
      title="Add a business"
      submitLabel="Add business"
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (Object.keys(problems).length > 0) {
          return;
        }
        let created: AdminBusinessCreated | null = null;
        void runner
          .run(async () => {
            created = await getApi().admin.createBusiness(toCreateBusinessInput(form));
          })
          .then((outcome) => {
            if (outcome === "ok" && created !== null) {
              onCreated(created);
              onClose();
            }
          });
      }}
    >
      <TextField
        label="Business name"
        value={form.name}
        onChange={set("name")}
        maxLength={200}
        error={shown("name")}
      />
      <TextField
        label="Address"
        value={form.address}
        onChange={set("address")}
        maxLength={500}
        error={shown("address")}
      />
      <TextField
        label="Business phone (optional)"
        type="tel"
        value={form.phone}
        onChange={set("phone")}
        maxLength={50}
      />

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">What its printers can do</legend>
        {CAPABILITY_OPTIONS.map((option) => (
          <CheckField
            key={option.key}
            label={option.label}
            checked={form.capabilities[option.key]}
            onChange={(checked) =>
              setForm((current) => ({
                ...current,
                capabilities: { ...current.capabilities, [option.key]: checked },
              }))
            }
          />
        ))}
        <p className="text-xs text-muted">
          Every order is checked against these, and the business cannot change them later, so tick
          everything its printers can do.
        </p>
      </fieldset>

      <fieldset className="grid gap-3 border-t border-line pt-3">
        <legend className="text-sm font-medium">Owner</legend>
        <TextField
          label="Owner's name"
          value={form.ownerName}
          onChange={set("ownerName")}
          maxLength={200}
          error={shown("ownerName")}
        />
        <TextField
          label="Owner's email"
          type="email"
          value={form.ownerEmail}
          onChange={set("ownerEmail")}
          maxLength={254}
          error={shown("ownerEmail")}
        />
        <TextField
          label="Owner's phone (optional)"
          type="tel"
          value={form.ownerPhone}
          onChange={set("ownerPhone")}
          maxLength={30}
        />
        <p className="text-xs text-muted">
          We create the owner&apos;s account and email them a code to set their own password. The
          email address must not already have an account.
        </p>
      </fieldset>

      <p className="text-xs text-muted">
        The business starts closed, same as any new shop. Its own staff (or you, on their behalf,
        from its detail page) open it once printers and products are ready.
      </p>
    </FormDialog>
  );
}

function noop(): void {}
