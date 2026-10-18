"use client";

import { useCallback, useState, type ReactNode } from "react";
import type { BranchSummary } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { ShopQrCode } from "@/components/admin/shop-qr-code";
import { CheckField, TextField } from "@/components/form-kit";
import { FormDialog, Modal } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import {
  Button,
  Cell,
  DataTable,
  EmptyState,
  LiveStatus,
  Notice,
  PageHeader,
  Panel,
  Pill,
  Row,
} from "@/components/ui";
import { getApi } from "@/lib/api";
import {
  branchStatus,
  canOpenClose,
  changedBranchFields,
  validateBranchForm,
} from "@/lib/branch-view";
import { useResource } from "@/lib/use-resource";

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; branch: BranchSummary }
  | { kind: "qr"; branch: BranchSummary }
  | { kind: "archive"; branch: BranchSummary };

/** A business's physical locations. Only owners reach this page (business settings access): they
 * add branches, edit them, open or close them and archive the ones no longer used. A branch is
 * archived, never deleted, so its history stays; it cannot be archived while people work there
 * (move them on the Staff page first) or while it is the business's last branch.
 *
 * Each branch has its own guest-ordering QR code: a customer who scans it orders from that branch.
 * Orders and printers belong to a branch; stock is not split by branch yet. */
export function BranchesScreen(): ReactNode {
  return (
    <RequirePermission permission={Permission.MANAGE_SETTINGS} what="branches">
      <BranchesBody />
    </RequirePermission>
  );
}

function BranchesBody(): ReactNode {
  const { business, businessRole, permissions, reloadBranches } = useSession();
  const shopId = business?.id ?? "";
  const [showArchived, setShowArchived] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const list = useResource(
    () => getApi().branches.list(shopId, { includeArchived: showArchived }),
    [shopId, showArchived],
    { intervalMs: 60_000, enabled: shopId !== "" },
  );
  // A change here also reaches the console's branch switcher, which holds its own copy of the list.
  const reloadList = list.reload;
  const refresh = useCallback(() => {
    reloadList();
    reloadBranches();
  }, [reloadList, reloadBranches]);
  const toggle = useActionRunner(refresh);
  const actor = { permissions, role: businessRole, branchId: business?.branchId ?? null };

  return (
    <>
      <PageHeader
        title="Branches"
        subtitle={business?.name}
        actions={
          <>
            <LiveStatus
              lastUpdated={list.lastUpdated}
              refreshing={list.refreshing}
              onRefresh={list.reload}
            />
            <Button variant="primary" onClick={() => setDialog({ kind: "create" })}>
              Add a branch
            </Button>
          </>
        }
      />
      <p className="mb-4 max-w-2xl text-sm text-muted">
        Each branch is one location of {business?.name ?? "the business"}. Give every branch its own
        manager on the Staff page. Prices, products and settings stay shared by all branches. Each
        branch has its own QR code: a customer who scans it orders from that branch.
      </p>
      {toggle.error !== null && (
        <Notice tone="danger" role="alert" className="mb-4">
          {toggle.error}
        </Notice>
      )}
      <div className="mb-4">
        <CheckField
          label="Show archived branches"
          checked={showArchived}
          onChange={setShowArchived}
        />
      </div>
      <ResourceBoundary state={list} what="branches">
        {(branches) =>
          branches.length === 0 ? (
            <EmptyState title="No branches yet">
              Add the first location of this business.
            </EmptyState>
          ) : (
            <Panel flushOnPhone>
              <DataTable
                caption="Branches"
                head={["Branch", "Address", "Manager", "People", "Status", ""]}
                stackOnPhone
              >
                {branches.map((branch) => {
                  const status = branchStatus(branch);
                  return (
                    <Row key={branch.id}>
                      <Cell className="font-medium">
                        {branch.name}
                        {branch.city !== null && (
                          <span className="block text-xs font-normal text-muted">
                            {branch.city}
                          </span>
                        )}
                        {branch.id === (business?.branchId ?? "") && branch.id !== "" && (
                          <span className="ml-2 text-xs text-muted">(yours)</span>
                        )}
                      </Cell>
                      <Cell label="Address" className="text-muted">
                        {branch.address}
                        {branch.phone !== null && (
                          <span className="block text-xs">{branch.phone}</span>
                        )}
                      </Cell>
                      <Cell label="Manager">
                        {branch.managers.length === 0 ? (
                          <span className="text-muted">No manager yet</span>
                        ) : (
                          branch.managers.map((manager) => manager.name).join(", ")
                        )}
                      </Cell>
                      <Cell label="People">{branch.staffCount}</Cell>
                      <Cell label="Status">
                        <Pill
                          tone={
                            status === "open" ? "good" : status === "closed" ? "caution" : "neutral"
                          }
                        >
                          {status === "open" ? "Open" : status === "closed" ? "Closed" : "Archived"}
                        </Pill>
                      </Cell>
                      <Cell className="text-right whitespace-nowrap">
                        {status !== "archived" && (
                          <>
                            <Button
                              variant="ghost"
                              onClick={() => setDialog({ kind: "qr", branch })}
                            >
                              QR code
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => setDialog({ kind: "edit", branch })}
                            >
                              Edit
                            </Button>
                            {canOpenClose(actor, branch) && (
                              <Button
                                variant="ghost"
                                disabled={toggle.busy}
                                onClick={() =>
                                  void toggle.run(() =>
                                    getApi().branches.setOpen(branch.id, !branch.isOpen),
                                  )
                                }
                              >
                                {branch.isOpen ? "Close" : "Open"}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              onClick={() => setDialog({ kind: "archive", branch })}
                            >
                              Archive
                            </Button>
                          </>
                        )}
                      </Cell>
                    </Row>
                  );
                })}
              </DataTable>
            </Panel>
          )
        }
      </ResourceBoundary>
      {dialog?.kind === "create" && (
        <BranchFormDialog shopId={shopId} onClose={() => setDialog(null)} onSaved={refresh} />
      )}
      {dialog?.kind === "edit" && (
        <BranchFormDialog
          shopId={shopId}
          branch={dialog.branch}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      )}
      {dialog?.kind === "qr" && (
        <QrDialog
          shopId={shopId}
          shopName={business?.name}
          branch={dialog.branch}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "archive" && (
        <ArchiveDialog branch={dialog.branch} onClose={() => setDialog(null)} onSaved={refresh} />
      )}
    </>
  );
}

/** The branch's guest-ordering code and link. A closed branch still has its code (it works again
 * once the branch is opened), and says so, so nobody prints one and wonders why orders bounce. */
function QrDialog({
  shopId,
  shopName,
  branch,
  onClose,
}: {
  shopId: string;
  shopName: string | undefined;
  branch: BranchSummary;
  onClose: () => void;
}): ReactNode {
  return (
    <Modal title={`QR code for ${branch.name}`} onClose={onClose} dismissOnBackdrop>
      <div className="grid gap-3 px-5 py-4 text-sm">
        {!branch.isOpen && (
          <Notice tone="caution" role="note">
            {branch.name} is closed, so customers who scan this code are told so until you open it.
          </Notice>
        )}
        <ShopQrCode
          framed={false}
          shopId={shopId}
          shopName={shopName}
          branchId={branch.id}
          branchName={branch.name}
        />
      </div>
    </Modal>
  );
}

function BranchFormDialog({
  shopId,
  branch,
  onClose,
  onSaved,
}: {
  shopId: string;
  branch?: BranchSummary;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  const [name, setName] = useState(branch?.name ?? "");
  const [city, setCity] = useState(branch?.city ?? "");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [phone, setPhone] = useState(branch?.phone ?? "");
  const [touched, setTouched] = useState(false);
  const errors = validateBranchForm({ name, address, city, phone });
  return (
    <FormDialog
      title={branch ? `Edit ${branch.name}` : "Add a branch"}
      submitLabel={branch ? "Save branch" : "Add branch"}
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() => {
        setTouched(true);
        if (errors.name || errors.address || errors.city || errors.phone) return;
        if (branch) {
          // Only what changed is sent, so a field left alone can never make the save fail.
          const changes = changedBranchFields(branch, { name, city, address, phone });
          if (Object.keys(changes).length === 0) {
            onClose();
            return;
          }
          void runner
            .run(() => getApi().branches.update(branch.id, changes))
            .then((outcome) => outcome === "ok" && onClose());
          return;
        }
        void runner
          .run(() =>
            getApi().branches.create(shopId, {
              name: name.trim(),
              address: address.trim(),
              city: city.trim() === "" ? undefined : city.trim(),
              phone: phone.trim() === "" ? undefined : phone.trim(),
            }),
          )
          .then((outcome) => outcome === "ok" && onClose());
      }}
    >
      <TextField
        label="Branch name"
        value={name}
        onChange={setName}
        error={touched ? (errors.name ?? null) : null}
      />
      <TextField
        label="City"
        value={city}
        onChange={setCity}
        error={touched ? (errors.city ?? null) : null}
      />
      <TextField
        label="Address"
        value={address}
        onChange={setAddress}
        error={touched ? (errors.address ?? null) : null}
      />
      <TextField
        label="Phone"
        value={phone}
        onChange={setPhone}
        error={touched ? (errors.phone ?? null) : null}
      />
    </FormDialog>
  );
}

function ArchiveDialog({
  branch,
  onClose,
  onSaved,
}: {
  branch: BranchSummary;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const runner = useActionRunner(onSaved);
  return (
    <FormDialog
      title={`Archive ${branch.name}`}
      submitLabel="Archive branch"
      submitTone="danger"
      busy={runner.busy}
      error={runner.error}
      onCancel={onClose}
      onSubmit={() =>
        void runner
          .run(() => getApi().branches.archive(branch.id))
          .then((outcome) => outcome === "ok" && onClose())
      }
    >
      <p>
        {branch.name} stops being used, but its history is kept. This is only possible once nobody
        works there{branch.staffCount > 0 ? ` (${branch.staffCount} still do)` : ""}: move them to
        another branch on the Staff page first.
      </p>
    </FormDialog>
  );
}
