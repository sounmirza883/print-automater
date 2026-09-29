"use client";

import { Check, Minus } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, Section, SectionHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { comparison, plans, pricingNote, type PlanValue } from "@/content/pricing";
import { siteConfig } from "@/content/site";
import { annualSavings, monthlyPrice, type BillingCycle } from "@/lib/pricing";

const cycles: { value: BillingCycle; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "annual", label: "Annual" },
];

// There is no self-service sign-up anymore (shops are provisioned by an admin), so every
// plan's CTA routes to sales rather than a plan-specific trial flow.
function planHref(): string {
  return `mailto:${siteConfig.contactEmail}`;
}

function Cell({ value }: { value: PlanValue }) {
  if (value === true) {
    return (
      <>
        <Check aria-hidden="true" className="mx-auto size-5 text-emerald-600" />
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <Minus aria-hidden="true" className="mx-auto size-5 text-ink-400" />
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span className="font-medium text-ink-900">{value}</span>;
}

export function Pricing() {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

  return (
    <Section id="pricing" tone="light">
      <SectionHeader
        id="pricing"
        eyebrow="Pricing"
        title="Simple plans that grow with your shop"
        lede="Pick the plan that matches your printers, team and order volume. Change any time."
      />

      <div className="mt-10 flex flex-col items-center gap-3">
        <div
          role="radiogroup"
          aria-label="Billing period"
          className="inline-flex rounded-full border border-ink-200 bg-ink-50 p-1"
        >
          {cycles.map((c) => (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={cycle === c.value}
              onClick={() => setCycle(c.value)}
              className={cn(
                "rounded-full px-5 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
                cycle === c.value
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-ink-700 hover:text-ink-900",
              )}
            >
              {c.label}
              {c.value === "annual" ? (
                <span
                  className={cn(
                    "ml-1.5 text-xs",
                    cycle === "annual" ? "text-brand-100" : "text-emerald-700",
                  )}
                >
                  2 months free
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid items-stretch gap-6 lg:grid-cols-3">
        {plans.map((plan) => {
          const price = monthlyPrice(plan.monthly, cycle);
          return (
            <Card
              key={plan.id}
              className={cn(
                "relative flex flex-col p-7",
                plan.highlighted && "border-brand-500 shadow-lg ring-1 ring-brand-500 lg:-my-3",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-ink-900">{plan.name}</h3>
                {plan.highlighted ? <Badge variant="brand">Most popular</Badge> : null}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">{plan.tagline}</p>
              <p className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight text-ink-900">${price}</span>
                <span className="text-sm text-ink-600">/ month</span>
              </p>
              <p className="mt-1 h-5 text-xs text-ink-600" aria-live="polite">
                {cycle === "annual"
                  ? `Billed yearly. Save $${annualSavings(plan.monthly)} a year.`
                  : "Billed monthly."}
              </p>
              <ul className="mt-6 flex-1 space-y-3 text-sm text-ink-700">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                href={planHref()}
                variant={plan.highlighted ? "primary" : "secondary"}
                fullWidth
                className="mt-8"
              >
                {plan.cta}
              </Button>
            </Card>
          );
        })}
      </div>

      <p className="mt-6 text-center text-xs text-ink-600">{pricingNote}</p>

      <h3 className="mt-16 text-center text-xl font-semibold text-ink-900">Compare plans</h3>
      <div className="relative mt-6 overflow-x-auto rounded-2xl border border-ink-100">
        <table className="w-full min-w-160 border-collapse text-left text-sm">
          <caption className="sr-only">Comparison of Starter, Growth and Business plans</caption>
          <thead>
            <tr className="bg-ink-50">
              <th scope="col" className="px-5 py-4 font-semibold text-ink-900">
                Feature
              </th>
              {plans.map((p) => (
                <th
                  key={p.id}
                  scope="col"
                  className={cn(
                    "px-5 py-4 text-center font-semibold text-ink-900",
                    p.highlighted && "bg-brand-50 text-brand-800",
                  )}
                >
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          {comparison.map((group) => (
            <tbody key={group.group} className="border-t border-ink-100">
              <tr>
                <th
                  scope="colgroup"
                  colSpan={4}
                  className="bg-white px-5 pt-5 pb-2 font-mono text-xs tracking-wide text-ink-600 uppercase"
                >
                  {group.group}
                </th>
              </tr>
              {group.rows.map((row) => (
                <tr key={row.label} className="border-t border-ink-100 hover:bg-ink-50/60">
                  <th scope="row" className="px-5 py-3.5 font-normal text-ink-700">
                    {row.label}
                  </th>
                  {plans.map((p) => (
                    <td
                      key={p.id}
                      className={cn("px-5 py-3.5 text-center", p.highlighted && "bg-brand-50/50")}
                    >
                      <Cell value={row.values[p.id]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </Section>
  );
}
