import type { Metadata } from "next";
import { BookOpen, Check, Compass, Mail, type LucideIcon } from "lucide-react";
import { PageHero, PageShell } from "@/components/pages";
import { Button, Card, IconTile, Section, SectionHeader } from "@/components/ui";
import { faqs } from "@/content/faq";
import { siteConfig } from "@/content/site";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Get help with Print Automated: email support, documentation, guides and a checklist of what to include in your request.",
};

const options: readonly {
  title: string;
  body: string;
  cta: string;
  href: string;
  icon: LucideIcon;
}[] = [
  {
    title: "Email support",
    body: "Write to us at any time. A person reads every message.",
    cta: siteConfig.contactEmail,
    href: `mailto:${siteConfig.contactEmail}`,
    icon: Mail,
  },
  {
    title: "Documentation",
    body: "Reference for setting up your shop and every screen.",
    cta: "Read the docs",
    href: siteConfig.docsUrl,
    icon: BookOpen,
  },
  {
    title: "Guides",
    body: "Task-focused articles for pricing, printers, stock and staff.",
    cta: "Open guides",
    href: "/guides",
    icon: Compass,
  },
];

const checklist = [
  "Your shop name and the email you sign in with",
  "What you were trying to do, and what happened instead",
  "The order number, if it concerns a specific order",
  "The printer name and whether it shows as online, if it concerns printing",
  "Screenshots or exact error messages",
  "When it started, and whether it happens every time",
] as const;

const supportFaqs = faqs.filter((f) => f.category === "Support" || f.category === "Setup");

export default function SupportPage() {
  return (
    <PageShell>
      <PageHero
        eyebrow="Support"
        title="Talk to a person when something needs a hand"
        lede="Most questions are answered in the docs and guides. For anything else, email us."
        crumbs={[{ label: "Home", href: "/" }, { label: "Support" }]}
      />

      <Section id="options" tone="light">
        <SectionHeader
          id="options"
          align="left"
          eyebrow="Ways to get help"
          title="Choose what suits you"
        />
        <ul className="mt-10 grid gap-6 md:grid-cols-3">
          {options.map((o) => (
            <li key={o.title}>
              <Card className="flex h-full flex-col">
                <IconTile icon={o.icon} tone="brand" />
                <h3 className="mt-4 text-lg font-bold text-ink-950">{o.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600">{o.body}</p>
                <div className="mt-5">
                  <Button href={o.href} variant="secondary" size="sm" className="max-w-full">
                    <span className="truncate">{o.cta}</span>
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
        <p className="mt-8 max-w-3xl text-sm leading-relaxed text-ink-700">
          <strong className="font-semibold text-ink-900">Response times.</strong> We aim to reply
          within one business day. Business plans include a dedicated contact. These are goals, not
          guarantees, and response times may be longer around holidays.
        </p>
      </Section>

      <Section id="request-checklist" tone="muted">
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeader
              id="request-checklist"
              align="left"
              eyebrow="Before you write"
              title="What to include in your request"
              lede="The more we know up front, the fewer questions we need to ask back."
            />
            <ul className="mt-8 space-y-3">
              {checklist.map((c) => (
                <li key={c} className="flex items-start gap-2.5 text-sm text-ink-800">
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-brand-600"
                    strokeWidth={2.25}
                  />
                  {c}
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Button href={`mailto:${siteConfig.contactEmail}`}>Email support</Button>
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-ink-950">Common setup and support questions</h2>
            <dl className="mt-6 divide-y divide-ink-400 border-y border-ink-400">
              {supportFaqs.map((f) => (
                <div key={f.id} className="py-5">
                  <dt className="font-semibold text-ink-900">{f.question}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-ink-700">{f.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Section>
    </PageShell>
  );
}
