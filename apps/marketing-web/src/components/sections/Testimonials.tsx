import { Reveal, Section, SectionHeader } from "@/components/ui";
import { testimonials, testimonialsNote } from "@/content/testimonials";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Testimonials() {
  return (
    <Section id="testimonials" tone="muted">
      <SectionHeader
        id="testimonials"
        eyebrow="Testimonials"
        title="Shops that stopped chasing the queue"
        lede="What running on Print Automated feels like at the counter and in the back room."
      />

      <ul className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {testimonials.map((t, i) => (
          <li key={t.name}>
            <Reveal delay={(i % 3) * 60} className="h-full">
              <figure className="flex h-full flex-col rounded-2xl border border-ink-100 bg-white p-6 shadow-sm">
                <blockquote className="flex-1 text-base leading-relaxed text-ink-800">
                  <p>&ldquo;{t.quote}&rdquo;</p>
                </blockquote>
                <figcaption className="mt-6 flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-100 font-mono text-sm font-semibold text-brand-800"
                  >
                    {initials(t.name)}
                  </span>
                  <span className="text-sm">
                    <span className="block font-semibold text-ink-900">{t.name}</span>
                    <span className="block text-ink-600">
                      {t.role}, {t.shop}
                    </span>
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-center text-xs text-ink-600">{testimonialsNote}</p>
    </Section>
  );
}
