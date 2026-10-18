"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  annualSaving,
  billedNote,
  cardBullets,
  formatPlanPrice,
  monthlyYearTotal,
  periodUnit,
  priceLabel,
  type BillingCycle,
  type PublicFeature,
  type PublicPlan,
} from "@/lib/plans";

const cycles: { value: BillingCycle; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Annual" },
];

// Literal class names (Tailwind cannot see interpolated ones).
const COLUMNS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

/** The pricing cards with the Monthly / Annual toggle. All data comes from the admin
 * panel through `GET /v1/plans`; nothing here is hard-coded. The toggle only appears
 * when at least one paid plan has an annual price. */
export function PricingPlans({
  plans,
  features,
  contactHref,
}: {
  plans: PublicPlan[];
  features: PublicFeature[];
  contactHref: string;
}) {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const hasAnnual = plans.some((p) => !p.contactOnly && p.annualPriceMinor !== null);
  const view: BillingCycle = hasAnnual ? cycle : "monthly";

  return (
    <>
      {hasAnnual ? (
        <div className="mt-10 flex flex-col items-center gap-3">
          <div
            role="radiogroup"
            aria-label="Billing period"
            className="inline-flex border border-ink-400 bg-ink-50 p-1"
          >
            {cycles.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={cycle === c.value}
                onClick={() => setCycle(c.value)}
                className={cn(
                  "h-10 px-6 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2",
                  cycle === c.value ? "bg-ink-900 text-ink-50" : "text-ink-700 hover:text-ink-950",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          "mt-10 grid items-stretch gap-6 sm:grid-cols-2",
          COLUMNS[Math.min(Math.max(plans.length, 1), 4)],
        )}
      >
        {plans.map((plan) => (
          <PlanCard
            key={plan.name}
            plan={plan}
            cycle={view}
            bullets={cardBullets(plan, features)}
            contactHref={contactHref}
          />
        ))}
      </div>
    </>
  );
}

function PlanCard({
  plan,
  cycle,
  bullets,
  contactHref,
}: {
  plan: PublicPlan;
  cycle: BillingCycle;
  bullets: string[];
  contactHref: string;
}) {
  const annual = cycle === "annual" && plan.annualPriceMinor !== null && !plan.contactOnly;
  const saving = annual ? annualSaving(plan) : 0;

  return (
    <Card
      className={cn(
        "relative flex flex-col p-7",
        plan.highlighted && "border-ink-900 ring-1 ring-ink-900 lg:-my-3",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xl font-bold text-ink-950">{plan.name}</h3>
        {plan.highlighted ? <Badge variant="brand">Most popular</Badge> : null}
      </div>
      {plan.description !== null && plan.description !== "" ? (
        <p className="mt-2 text-base leading-relaxed text-ink-600">{plan.description}</p>
      ) : null}

      {plan.contactOnly ? (
        <p className="mt-6 font-display text-3xl font-bold text-ink-950">
          {priceLabel(plan, cycle)}
        </p>
      ) : (
        <>
          <p className="mt-6 flex flex-wrap items-baseline gap-x-2">
            {saving > 0 ? (
              <s className="text-lg text-ink-600">
                {formatPlanPrice(monthlyYearTotal(plan), plan.currency)}
              </s>
            ) : null}
            <span className="whitespace-nowrap font-display text-4xl font-bold text-ink-950">
              {priceLabel(plan, cycle)}
            </span>
            <span className="text-sm text-ink-600">
              / {annual ? "year" : periodUnit(plan.billingPeriodDays)}
            </span>
          </p>
          <p className="mt-1 min-h-5 text-xs text-ink-600" aria-live="polite">
            {annual
              ? saving > 0
                ? `Billed yearly. Save ${formatPlanPrice(saving, plan.currency)} a year.`
                : "Billed yearly."
              : billedNote(plan.billingPeriodDays)}
          </p>
        </>
      )}

      {bullets.length > 0 && !plan.contactOnly ? (
        <ul className="mb-8 mt-6 space-y-3 text-base text-ink-700">
          {bullets.map((bullet) => (
            <li key={bullet} className="flex gap-2.5">
              <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-ink-950" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <Button
        href={contactHref}
        variant={plan.highlighted ? "primary" : "secondary"}
        fullWidth
        className="mt-auto"
      >
        {plan.contactOnly ? "Contact us" : "Talk to us"}
      </Button>
    </Card>
  );
}
