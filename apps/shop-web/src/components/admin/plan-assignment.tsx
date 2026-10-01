"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import type { PlanDefinitionResponse, ShopPlanResponse } from "@print-automated/types";
import { INPUT, SelectField } from "@/components/form-kit";
import { FormDialog } from "@/components/modal";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { Button, Pill } from "@/components/ui";
import { getApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  activateLabel,
  assignablePlans,
  assignedPlanName,
  defaultPlanChoice,
  planOptionLabel,
  planStateLabel,
} from "@/lib/plan-view";

/** Plan management: the one place a platform admin assigns, renews, changes or
 * cancels ONE business's plan. Shared by the Platform dashboard's plan table
 * (`compact`, one per row) and the business's own Plan panel, so the choice,
 * the button wording and the cancel confirmation are identical in both. */

export function PlanStatePill({ plan }: { plan: ShopPlanResponse }): ReactNode {
  return <Pill tone={plan.active ? "good" : "danger"}>{planStateLabel(plan)}</Pill>;
}

/** Name, state and date in one table cell. `null` = the status could not be loaded. */
export function PlanStatusCell({ plan }: { plan: ShopPlanResponse | null }): ReactNode {
  if (plan === null) {
    return <span className="text-muted">Unavailable</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-medium">{assignedPlanName(plan)}</span>
      <PlanStatePill plan={plan} />
      {plan.plan?.archived && <Pill>Archived plan</Pill>}
      {plan.expiresAt !== null && (
        <span className="text-muted">
          {plan.active ? "until" : "ended"} {formatDate(plan.expiresAt)}
        </span>
      )}
    </span>
  );
}

export function PlanAssignment({
  shopId,
  shopName,
  current,
  plans,
  compact = false,
  onChanged,
}: {
  shopId: string;
  shopName: string;
  /** null when the business's plan status could not be loaded. */
  current: ShopPlanResponse | null;
  plans: readonly PlanDefinitionResponse[];
  compact?: boolean;
  onChanged: (plan: ShopPlanResponse) => void;
}): ReactNode {
  const choices = assignablePlans(plans);
  const [choice, setChoice] = useState(() => defaultPlanChoice(current, choices));
  // A plan archived or deleted since the picker opened is not offered any more.
  const selected = choices.some((plan) => plan.id === choice)
    ? choice
    : defaultPlanChoice(current, choices);
  const activateRunner = useActionRunner(noop);
  const cancelRunner = useActionRunner(noop);
  const busy = activateRunner.busy || cancelRunner.busy;
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const selectId = useId();

  function activate(): void {
    setNotice(null);
    let updated: ShopPlanResponse | null = null;
    void activateRunner
      .run(async () => {
        updated = await getApi().plan.adminActivate(shopId, selected);
      })
      .then((outcome) => {
        if (outcome === "ok" && updated !== null) {
          onChanged(updated);
          setNotice(
            updated.expiresAt === null
              ? "Plan saved."
              : `Plan saved: active until ${formatDate(updated.expiresAt)}.`,
          );
        }
      });
  }

  function cancelPlan(): void {
    setNotice(null);
    let updated: ShopPlanResponse | null = null;
    void cancelRunner
      .run(async () => {
        updated = await getApi().plan.adminCancel(shopId);
      })
      .then((outcome) => {
        if (outcome === "ok" && updated !== null) {
          onChanged(updated);
          setConfirmingCancel(false);
          setNotice("Plan cancelled.");
        }
      });
  }

  const options = choices.map((plan) => ({ value: plan.id, label: planOptionLabel(plan) }));
  // A named plan can be unassigned whether it's still active or already lapsed --
  // the backend's cancel() handles both (an already-expired expiry is left where
  // it is, never pushed forward). Gating this on `active` alone stranded a lapsed
  // business: the only path left was "Activate", which hands it a brand-new paid
  // period just to detach the old plan, and a plan with any lapsed subscriber
  // could never be deleted (DELETE refuses while subscriberCount > 0).
  const hasAssignedPlan = current?.plan != null;
  const canCancel = hasAssignedPlan;
  const planIsLapsed = hasAssignedPlan && current?.active === false;

  const picker =
    choices.length === 0 ? (
      <p className="text-sm text-muted">
        No plans to choose from.{" "}
        <Link href="/admin/plans" className="underline underline-offset-2">
          Create a plan
        </Link>{" "}
        first.
      </p>
    ) : compact ? (
      <>
        <label className="sr-only" htmlFor={selectId}>
          Plan for {shopName}
        </label>
        <select
          id={selectId}
          value={selected}
          onChange={(event) => setChoice(event.target.value)}
          className={`${INPUT} max-w-[16rem]`}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </>
    ) : (
      <SelectField
        label="Plan"
        value={selected}
        onChange={setChoice}
        options={options}
        hint="Activating adds the chosen plan's billing period to the current expiry date, or to today if the plan has already run out. Choose the current plan again to renew it."
      />
    );

  const buttons = (
    <div className="flex flex-wrap items-center gap-2">
      {choices.length > 0 && (
        <Button variant="primary" disabled={busy || selected === ""} onClick={activate}>
          {activateRunner.busy ? "Saving…" : activateLabel(current, selected)}
        </Button>
      )}
      {canCancel && (
        <Button
          disabled={busy}
          onClick={() => {
            cancelRunner.clearError();
            setConfirmingCancel(true);
          }}
        >
          {planIsLapsed ? "Remove plan" : "Cancel plan"}
        </Button>
      )}
    </div>
  );

  return (
    <div className={compact ? "grid gap-1" : "grid gap-3 sm:max-w-lg"}>
      {compact ? (
        <div className="flex flex-wrap items-center gap-2">
          {picker}
          {buttons}
        </div>
      ) : (
        <>
          {picker}
          {buttons}
        </>
      )}
      {activateRunner.error !== null && (
        <p role="alert" className="text-xs text-danger-fg">
          {activateRunner.error}
        </p>
      )}
      {notice !== null && (
        <p role="status" className="text-xs text-good-fg">
          {notice}
        </p>
      )}
      {confirmingCancel && (
        <FormDialog
          title={planIsLapsed ? `Remove ${shopName}'s plan` : `Cancel ${shopName}'s plan`}
          submitLabel={planIsLapsed ? "Remove plan" : "Cancel plan"}
          submitTone="danger"
          busy={cancelRunner.busy}
          error={cancelRunner.error}
          onCancel={() => setConfirmingCancel(false)}
          onSubmit={cancelPlan}
        >
          <p>
            {planIsLapsed ? (
              <>
                This plan already ended. Removing the assignment frees {shopName} to be deleted or
                moved onto a different plan later -- it does not change when printing stopped, and
                the business and its history are not deleted.
              </>
            ) : (
              <>
                The plan ends now, not on its expiry date. {shopName} cannot print until a plan is
                activated again; its staff can still sign in and everything else keeps working. The
                business and its history are not deleted.
              </>
            )}
          </p>
        </FormDialog>
      )}
    </div>
  );
}

function noop(): void {}
