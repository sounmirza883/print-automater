"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ShopStatus } from "@print-automated/types";
import { Pager, TextField } from "@/components/form-kit";
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
          onCreated={() => {
            setPage(0);
            list.reload();
          }}
        />
      )}
    </>
  );
}

function CreateBusinessDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}): ReactNode {
  const runner = useActionRunner(onCreated);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [touched, setTouched] = useState(false);
  const nameError = name.trim() === "" ? "Enter a business name." : null;
  const addressError = address.trim() === "" ? "Enter an address." : null;

  return (
    <FormDialog
      title="Add a business"
      submitLabel="Add business"
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (nameError !== null || addressError !== null) {
          return;
        }
        void runner
          .run(() =>
            getApi().admin.createBusiness({
              name: name.trim(),
              address: address.trim(),
              phone: phone.trim() === "" ? undefined : phone.trim(),
            }),
          )
          .then((outcome) => {
            if (outcome === "ok") {
              onClose();
            }
          });
      }}
    >
      <TextField label="Name" value={name} onChange={setName} error={touched ? nameError : null} />
      <TextField
        label="Address"
        value={address}
        onChange={setAddress}
        error={touched ? addressError : null}
      />
      <TextField label="Phone (optional)" type="tel" value={phone} onChange={setPhone} />
      <p className="text-xs text-muted">
        The business starts closed, same as any new shop. Its own staff (or you, on their behalf,
        from its detail page) open it once printers and products are ready.
      </p>
    </FormDialog>
  );
}
