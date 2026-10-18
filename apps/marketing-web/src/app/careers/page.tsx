import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { PageHero, PageShell } from "@/components/pages";
import { Badge, Button, Card, Container } from "@/components/ui";
import { culture, openRoles } from "@/content/company";
import { siteConfig } from "@/content/site";

export const metadata: Metadata = {
  title: "Careers",
  description:
    "Work on software that runs real print shops. Our culture and how to get in touch about roles at Print Automated.",
  alternates: { canonical: "/careers" },
};

function applyHref(title: string) {
  return `mailto:${siteConfig.contactEmail}?subject=${encodeURIComponent(`Application: ${title}`)}`;
}

export default function CareersPage() {
  return (
    <PageShell>
      <PageHero
        eyebrow="Company"
        title="Help print shops run on autopilot"
        lede="We are a small team building practical software for a trade that has been underserved for a long time."
        crumbs={[{ label: "Home", href: "/" }, { label: "Careers" }]}
      />

      <Container className="space-y-16 py-14 md:space-y-20 md:py-20">
        <section aria-labelledby="culture">
          <h2 id="culture" className="text-2xl font-bold text-ink-950">
            How we work
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {culture.map((c) => (
              <li key={c.title}>
                <Card className="h-full">
                  <h3 className="font-bold text-ink-950">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-700">{c.body}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="roles">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="roles" className="text-2xl font-bold text-ink-950">
              Open roles
            </h2>
            <Badge variant="warning">Placeholder roles</Badge>
          </div>
          <p className="mt-3 max-w-2xl text-ink-700">
            The roles below are examples for layout only and are not real vacancies. Apply by email.
          </p>
          <ul className="mt-6 divide-y divide-ink-400 border border-ink-400 bg-white">
            {openRoles.map((role) => (
              <li
                key={role.title}
                className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <h3 className="font-bold text-ink-950">{role.title}</h3>
                  <p className="mt-1 text-sm text-ink-600">
                    {role.team} · {role.location}
                  </p>
                  <p className="mt-2 text-sm text-ink-700">{role.summary}</p>
                </div>
                <Button href={applyHref(role.title)} variant="secondary" size="sm">
                  <Mail aria-hidden="true" className="size-4" />
                  Apply by email
                </Button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="no-roles" className="border border-ink-400 bg-ink-50 p-6 md:p-8">
          <h2 id="no-roles" className="text-xl font-bold text-ink-950">
            Nothing that fits? Write to us.
          </h2>
          <p className="mt-2 max-w-2xl text-ink-700">
            If no role is open for you, tell us what you would like to work on and send a few lines
            about your background. We read every message.
          </p>
          <div className="mt-5">
            <Button href={applyHref("General enquiry")}>Email {siteConfig.contactEmail}</Button>
          </div>
        </section>
      </Container>
    </PageShell>
  );
}
