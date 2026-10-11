import { Button, Card, Section, SectionHeader } from "@/components/ui";
import { apiBaseUrl, siteConfig } from "@/content/site";
import { billedNote, fetchPlans, formatPlanPrice, periodUnit } from "@/lib/plans";

// There is no self-service sign-up (shops are provisioned by an admin), so every
// plan's CTA routes to sales rather than a plan-specific trial flow.
const contactHref = `mailto:${siteConfig.contactEmail}`;

/** The plans come from the admin panel (`/admin/plans`), not from this site: a
 * plan an admin creates, reprices or archives shows up here within a minute. */
export async function Pricing() {
  const plans = await fetchPlans(apiBaseUrl);

  return (
    <Section id="pricing" tone="light">
      <SectionHeader
        id="pricing"
        eyebrow="Pricing"
        title="Simple plans that grow with your shop"
        lede="Pick the plan that matches your printers, team and order volume. Change any time."
      />

      {plans !== null && plans.length > 0 ? (
        <div className="mt-10 grid items-stretch gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan.name} className="flex flex-col p-7">
              <h3 className="text-lg font-semibold text-ink-900">{plan.name}</h3>
              {plan.description !== null && plan.description !== "" ? (
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{plan.description}</p>
              ) : null}
              <p className="mt-6 flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-4xl font-semibold tracking-tight text-ink-900">
                  {formatPlanPrice(plan.priceMinor, plan.currency)}
                </span>
                <span className="text-sm text-ink-600">/ {periodUnit(plan.billingPeriodDays)}</span>
              </p>
              <p className="mt-1 text-xs text-ink-600">{billedNote(plan.billingPeriodDays)}</p>
              <Button href={contactHref} variant="secondary" fullWidth className="mt-auto">
                Talk to us
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="mx-auto mt-10 flex max-w-xl flex-col items-center p-8 text-center">
          <h3 className="text-lg font-semibold text-ink-900">
            {plans === null ? "Pricing is unavailable right now" : "Plans are being finalised"}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            Get in touch and we will send you current plans and prices.
          </p>
          <Button href={contactHref} variant="primary" className="mt-6">
            Talk to us
          </Button>
        </Card>
      )}
    </Section>
  );
}
