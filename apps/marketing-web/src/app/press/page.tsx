import type { Metadata } from "next";
import { PageHero, PageShell } from "@/components/pages";
import { Button, Card, Container } from "@/components/ui";
import { brandGuidance, pressBoilerplate, pressFacts } from "@/content/company";
import { siteConfig } from "@/content/site";

export const metadata: Metadata = {
  title: "Press",
  description:
    "Press information for Print Automated: boilerplate, key facts, brand and name usage guidance, and media contact.",
  alternates: { canonical: "/press" },
};

export default function PressPage() {
  return (
    <PageShell>
      <PageHero
        eyebrow="Company"
        title="Press and media"
        lede="Everything you need to write accurately about Print Automated."
        crumbs={[{ label: "Home", href: "/" }, { label: "Press" }]}
      />

      <Container className="space-y-16 py-14 md:space-y-20 md:py-20">
        <section aria-labelledby="boilerplate" className="max-w-3xl">
          <h2 id="boilerplate" className="text-2xl font-bold text-ink-950">
            About Print Automated
          </h2>
          <blockquote className="mt-4 border-l-4 border-brand-600 pl-5 text-lg leading-8 text-ink-800">
            {pressBoilerplate}
          </blockquote>
        </section>

        <section aria-labelledby="facts">
          <h2 id="facts" className="text-2xl font-bold text-ink-950">
            Key facts
          </h2>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            {pressFacts.map((f) => (
              <Card key={f.label} className="p-5">
                <dt className="font-mono text-xs uppercase tracking-[0.14em] text-ink-600">
                  {f.label}
                </dt>
                <dd className="mt-1 text-ink-900">{f.value}</dd>
              </Card>
            ))}
          </dl>
        </section>

        <section aria-labelledby="brand">
          <h2 id="brand" className="text-2xl font-bold text-ink-950">
            Brand guidance
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {brandGuidance.map((g) => (
              <li key={g.title}>
                <Card className="h-full">
                  <h3 className="font-bold text-ink-950">{g.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-700">{g.body}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="contact"
          data-tone="dark"
          className="bg-ink-900 p-8 text-ink-50 md:p-12"
        >
          <h2 id="contact" className="text-2xl font-bold">
            Media contact
          </h2>
          <p className="mt-3 max-w-2xl text-ink-200">
            For interviews, fact checks or logo files, email us. We reply within one business day.
          </p>
          <div className="mt-6">
            <Button href={`mailto:${siteConfig.contactEmail}?subject=Press%20enquiry`} tone="dark">
              {siteConfig.contactEmail}
            </Button>
          </div>
        </section>
      </Container>
    </PageShell>
  );
}
