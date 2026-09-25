import type { Metadata } from "next";
import { Button, IconTile } from "@/components/ui";
import { securityDoc } from "@/content/legal";
import { securityItems } from "@/content/security";
import { siteConfig } from "@/content/site";
import { LegalDocument } from "../privacy/LegalDocument";

export const metadata: Metadata = {
  title: "Security",
  description: securityDoc.description,
  alternates: { canonical: "/security" },
};

const reportHref = `mailto:${siteConfig.contactEmail}?subject=${encodeURIComponent("Security report")}`;

export default function SecurityPage() {
  return (
    <LegalDocument
      doc={securityDoc}
      intro={
        <section aria-labelledby="security-summary">
          <h2 id="security-summary" className="text-2xl font-semibold tracking-tight text-ink-900">
            Security at a glance
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {securityItems.map((item) => (
              <li
                key={item.title}
                className="flex gap-3 rounded-2xl border border-ink-100 bg-white p-5 shadow-sm"
              >
                <IconTile icon={item.icon} size="sm" tone="brand" />
                <div>
                  <h3 className="text-sm font-semibold text-ink-900">{item.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-700">{item.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      }
      outro={
        <div className="mt-12 rounded-2xl border border-ink-100 bg-ink-50 p-6">
          <h2 className="text-lg font-semibold text-ink-900">Found a vulnerability?</h2>
          <p className="mt-2 text-ink-700">
            Email {siteConfig.contactEmail} with details and steps to reproduce.
          </p>
          <div className="mt-4">
            <Button href={reportHref}>Report a vulnerability</Button>
          </div>
        </div>
      }
    />
  );
}
