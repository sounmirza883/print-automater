"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { OperatingHours, ShopSettings } from "@print-automated/api-client";
import { Permission } from "@print-automated/types";
import { CheckField, ErrorBanner, INPUT, TextField } from "@/components/form-kit";
import { useActionRunner } from "@/components/orders/use-action-runner";
import { RequirePermission, ResourceBoundary } from "@/components/resource-boundary";
import { useSession } from "@/components/session-provider";
import { Button, LiveStatus, PageHeader, Panel, Pill } from "@/components/ui";
import { getApi } from "@/lib/api";
import { errorCodeOf } from "@/lib/error-copy";
import { formatDateTime } from "@/lib/format";
import { basisPointsToPercent, percentToBasisPoints } from "@/lib/form-values";
import {
  AUTOMATION_TOGGLES,
  WEEKDAY_LABELS,
  buildSettingsPatch,
  draftFromSettings,
  mergeAfterConflict,
  validateHours,
  type SettingsDraft,
} from "@/lib/settings-view";
import { useResource } from "@/lib/use-resource";

/** PRD 75/76: business details and automation switches. Anyone with
 * VIEW_SETTINGS sees everything; each group is editable only with its own
 * permission (business details: the owner; automation: owner and manager),
 * and a group you cannot edit is shown read-only, never hidden. Saving is
 * optimistic (`expectedVersion`): if someone else saved first the latest is
 * reloaded, your untouched-by-them edits are kept, and anything both of you
 * changed shows their value with a notice. */
export function SettingsScreen(): ReactNode {
  return (
    <RequirePermission permission={Permission.VIEW_SETTINGS} what="settings">
      <SettingsBody />
    </RequirePermission>
  );
}

function SettingsBody(): ReactNode {
  const { business } = useSession();
  const shopId = business?.id ?? "";
  const settings = useResource(() => getApi().settings.get(shopId), [shopId], {
    enabled: shopId !== "",
  });
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={business?.name}
        actions={
          <>
            <Link href="/settings/printer-rules" className="text-sm font-medium underline">
              Printer rules
            </Link>
            <LiveStatus
              lastUpdated={settings.lastUpdated}
              refreshing={settings.refreshing}
              onRefresh={settings.reload}
            />
          </>
        }
      />
      <ResourceBoundary state={settings} what="settings">
        {(data) => (
          <SettingsForm key={data.shopId} data={data} shopId={shopId} reload={settings.reload} />
        )}
      </ResourceBoundary>
    </>
  );
}

function SettingsForm({
  data,
  shopId,
  reload,
}: {
  data: ShopSettings;
  shopId: string;
  reload: () => void;
}): ReactNode {
  const { can } = useSession();
  const canBusiness = can(Permission.MANAGE_SETTINGS);
  const canAutomation = can(Permission.MANAGE_AUTOMATION);
  const runner = useActionRunner(reload);
  const base = draftFromSettings(data);
  // Edits belong to one saved version: when the server's version moves (a save, a reload), they reset.
  const [local, setLocal] = useState<{ version: number; draft: SettingsDraft } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Remounts the self-contained tax field when edits are discarded or merged.
  const [resetKey, setResetKey] = useState(0);
  const draft = local !== null && local.version === data.version ? local.draft : base;
  const update = (patch: Partial<SettingsDraft>): void => {
    setNotice(null);
    setLocal({ version: data.version, draft: { ...draft, ...patch } });
  };

  const patch = buildSettingsPatch(base, draft, {
    business: canBusiness,
    automation: canAutomation,
  });
  const hoursProblems = canBusiness ? validateHours(draft.operatingHours) : [];
  const dirty = Object.keys(patch).length > 0;

  async function save(): Promise<void> {
    setNotice(null);
    await runner.run(async () => {
      try {
        await getApi().settings.update(shopId, data.version, patch);
      } catch (error) {
        if (errorCodeOf(error) === "SETTINGS_VERSION_CONFLICT") {
          const latest = await getApi().settings.get(shopId);
          const merge = mergeAfterConflict(base, draft, draftFromSettings(latest));
          setLocal({ version: latest.version, draft: merge.draft });
          setResetKey((value) => value + 1);
          setNotice(
            [
              merge.kept.length > 0 ? `Your changes to ${merge.kept.join(", ")} were kept.` : "",
              merge.overwritten.length > 0
                ? `${merge.overwritten.join(", ")} was also changed by someone else: their value is shown. Review, then save again.`
                : "Review the changes, then save again.",
            ]
              .filter(Boolean)
              .join(" "),
          );
        }
        throw error;
      }
      setLocal(null);
      setResetKey((value) => value + 1);
    });
  }

  return (
    <div className="grid gap-4">
      <ErrorBanner message={runner.error} />
      {notice !== null && (
        <p
          role="status"
          className="rounded-md border border-caution/50 bg-caution-soft px-3 py-2 text-sm"
        >
          {notice}
        </p>
      )}

      <Panel
        title="Business details"
        id="business"
        aside={<AccessPill allowed={canBusiness} who="the owner" />}
      >
        <fieldset disabled={!canBusiness || runner.busy} className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Currency"
              value={draft.currency}
              onChange={(value) => update({ currency: value.toUpperCase() })}
              maxLength={3}
              mono
              error={/^[A-Z]{3}$/.test(draft.currency) ? null : "Use a 3-letter code, like PKR."}
              hint="The default for new orders and prices. Orders already placed keep the currency they were quoted in."
            />
            <TaxField
              key={`${data.version}-${resetKey}`}
              value={draft.taxRateBasisPoints}
              onChange={(value) => update({ taxRateBasisPoints: value })}
            />
          </div>
          <NotificationChannels draft={draft} onChange={update} />
          <HoursEditor
            hours={draft.operatingHours}
            onChange={(hours) => update({ operatingHours: hours })}
            problems={hoursProblems}
          />
        </fieldset>
        {!canBusiness && (
          <p className="mt-3 text-xs text-muted">
            Business details can only be changed by the owner. You can see them here.
          </p>
        )}
      </Panel>

      <Panel
        title="Automation"
        id="automation"
        aside={<AccessPill allowed={canAutomation} who="the owner or a manager" />}
      >
        <p className="mb-3 text-sm text-muted">
          Every automatic step has a switch, and doing the same thing by hand always stays possible.
          Switching one off never loses work.
        </p>
        <fieldset disabled={!canAutomation || runner.busy} className="grid gap-4">
          {AUTOMATION_TOGGLES.map((toggle) => (
            <div key={toggle.key}>
              <CheckField
                label={toggle.label}
                checked={draft[toggle.key]}
                disabled={toggle.unavailable}
                onChange={(checked) => update({ [toggle.key]: checked })}
                hint={
                  toggle.unavailable ? (
                    <span>Not yet available. {toggle.offEffect}</span>
                  ) : (
                    <span>
                      <span className="font-medium">If switched off: </span>
                      {toggle.offEffect}
                    </span>
                  )
                }
              />
            </div>
          ))}
        </fieldset>
        {!canAutomation && (
          <p className="mt-3 text-xs text-muted">
            Automation can only be changed by the owner or a manager.
          </p>
        )}
      </Panel>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <span className="text-xs text-muted">
          Version {data.version}, last saved {formatDateTime(data.updatedAt)}
        </span>
        <div className="flex gap-2">
          <Button
            disabled={!dirty || runner.busy}
            onClick={() => {
              setLocal(null);
              setNotice(null);
              setResetKey((value) => value + 1);
              setResetKey((value) => value + 1);
            }}
          >
            Discard changes
          </Button>
          <Button
            variant="primary"
            disabled={
              !dirty ||
              runner.busy ||
              hoursProblems.length > 0 ||
              !/^[A-Z]{3}$/.test(draft.currency)
            }
            onClick={() => void save()}
          >
            {runner.busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AccessPill({ allowed, who }: { allowed: boolean; who: string }): ReactNode {
  return allowed ? <Pill tone="good">You can edit</Pill> : <Pill>Read-only: changed by {who}</Pill>;
}

function TaxField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}): ReactNode {
  const [text, setText] = useState(basisPointsToPercent(value));
  const parsed = percentToBasisPoints(text);
  return (
    <TextField
      label="Default tax rate (%)"
      value={text}
      mono
      onChange={(next) => {
        setText(next);
        const bps = percentToBasisPoints(next);
        if (bps !== undefined) onChange(bps);
      }}
      error={parsed === undefined ? "Enter a percentage from 0 to 100, up to two decimals." : null}
      hint="Blank means no default. Applies to new orders; orders already placed keep their tax."
    />
  );
}

function NotificationChannels({
  draft,
  onChange,
}: {
  draft: SettingsDraft;
  onChange: (patch: Partial<SettingsDraft>) => void;
}): ReactNode {
  const set =
    (key: "emailEnabled" | "appEnabled") =>
    (checked: boolean): void =>
      onChange({ notificationSettings: { ...draft.notificationSettings, [key]: checked } });
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">Customer notification channels</legend>
      <CheckField
        label="Send emails"
        checked={draft.notificationSettings.emailEnabled}
        onChange={set("emailEnabled")}
      />
      <CheckField
        label="Send in-app notices"
        checked={draft.notificationSettings.appEnabled}
        onChange={set("appEnabled")}
        hint="Rejected-order and print-failure notices to customers are always sent in the app, whatever is chosen here or in Automation."
      />
    </fieldset>
  );
}

const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function HoursEditor({
  hours,
  onChange,
  problems,
}: {
  hours: OperatingHours | null;
  onChange: (hours: OperatingHours | null) => void;
  problems: string[];
}): ReactNode {
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-medium">Operating hours</legend>
      <p className="text-xs text-muted">
        For information only: hours are shown as your opening times and do not stop orders coming in
        or change how jobs are allocated to printers.
      </p>
      <CheckField
        label="Publish operating hours"
        checked={hours !== null}
        onChange={(checked) => onChange(checked ? { timezone: "Asia/Karachi", weekly: {} } : null)}
      />
      {hours !== null && (
        <>
          <TextField
            label="Timezone"
            value={hours.timezone}
            onChange={(timezone) => onChange({ ...hours, timezone })}
            hint="An IANA name, like Asia/Karachi."
          />
          <div className="grid gap-2">
            {WEEK.map((day) => {
              const windows = hours.weekly[day] ?? [];
              const setWindows = (next: Array<{ open: string; close: string }>): void =>
                onChange({
                  ...hours,
                  weekly: { ...hours.weekly, [day]: next.length > 0 ? next : undefined },
                });
              return (
                <div key={day} className="grid grid-cols-[6.5rem_1fr] items-start gap-3 text-sm">
                  <span className="pt-1.5 font-medium">{WEEKDAY_LABELS[day]}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {windows.length === 0 && <span className="pt-1.5 text-muted">Closed</span>}
                    {windows.map((window, index) => (
                      <span key={index} className="flex items-center gap-1">
                        <input
                          aria-label={`${WEEKDAY_LABELS[day]} opens`}
                          value={window.open}
                          onChange={(e) =>
                            setWindows(
                              windows.map((w, i) =>
                                i === index ? { ...w, open: e.target.value } : w,
                              ),
                            )
                          }
                          className={`${INPUT} num w-20`}
                        />
                        <span aria-hidden="true">to</span>
                        <input
                          aria-label={`${WEEKDAY_LABELS[day]} closes`}
                          value={window.close}
                          onChange={(e) =>
                            setWindows(
                              windows.map((w, i) =>
                                i === index ? { ...w, close: e.target.value } : w,
                              ),
                            )
                          }
                          className={`${INPUT} num w-20`}
                        />
                        <Button
                          variant="ghost"
                          onClick={() => setWindows(windows.filter((_, i) => i !== index))}
                        >
                          Remove
                        </Button>
                      </span>
                    ))}
                    <Button
                      variant="ghost"
                      onClick={() => setWindows([...windows, { open: "09:00", close: "18:00" }])}
                    >
                      Add hours
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          {problems.length > 0 && (
            <ul role="alert" className="grid gap-1 text-xs text-danger-fg">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </fieldset>
  );
}
