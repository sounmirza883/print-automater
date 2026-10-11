import { Button, Card, Section, SectionHeader } from "@/components/ui";
import { apiBaseUrl, siteConfig } from "@/content/site";
import { fetchPlans } from "@/lib/plans";
import { CompareTable } from "./CompareTable";
import { PricingPlans } from "./PricingPlans";

// There is no self-service sign-up (shops are provisioned by an admin), so every
// plan's CTA routes to sales rather than a plan-specific trial flow.
const contactHref = `mailto:${siteConfig.contactEmail}`;

/** The plans come from the admin panel (`/admin/plans`), not from this site: a
 * plan an admin creates, reprices, reorders or archives, and the feature rows in the
 * Compare table, show up here within a minute. */
export async function Pricing() {
  const payload = await fetchPlans(apiBaseUrl);

  return (
    <Section id="pricing" tone="light">
      <SectionHeader
        id="pricing"
        eyebrow="Pricing"
        title="Simple plans that grow with your shop"
        lede="Pick the plan that matches your printers, team and order volume. Change any time."
      />

      {payload !== null && payload.plans.length > 0 ? (
        <>
          <PricingPlans
            plans={payload.plans}
            features={payload.features}
            contactHref={contactHref}
          />
          {payload.features.length > 0 ? (
            <CompareTable plans={payload.plans} features={payload.features} />
          ) : null}
        </>
      ) : (
        <Card className="mx-auto mt-10 flex max-w-xl flex-col items-center p-8 text-center">
          <h3 className="text-lg font-semibold text-ink-900">
            {payload === null ? "Pricing is unavailable right now" : "Plans are being finalised"}
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
