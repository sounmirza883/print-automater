"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Section, SectionHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { faqs } from "@/content/faq";

export function Faq() {
  const [openId, setOpenId] = useState<string | null>(faqs[0]?.id ?? null);

  return (
    <Section id="faq" tone="light">
      <SectionHeader
        id="faq"
        eyebrow="FAQ"
        title="Questions, answered"
        lede="The things shop owners ask most before they get started."
      />

      <div className="mt-16 max-w-4xl divide-y divide-ink-400 border border-ink-400 bg-ink-50">
        {faqs.map((item) => {
          const open = openId === item.id;
          const buttonId = `faq-${item.id}-button`;
          const panelId = `faq-${item.id}-panel`;
          return (
            <div key={item.id}>
              <h3>
                <button
                  id={buttonId}
                  type="button"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpenId(open ? null : item.id)}
                  className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-4 text-left text-lg font-bold text-ink-950 transition-colors duration-150 hover:bg-white focus-visible:outline-2 focus-visible:-outline-offset-2 sm:px-6"
                >
                  <span>{item.question}</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "size-5 shrink-0 text-ink-600 transition-transform duration-200 motion-reduce:transition-none",
                      open && "rotate-180",
                    )}
                  />
                </button>
              </h3>
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
                  open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
              >
                <div className="overflow-hidden" inert={!open}>
                  <p className="px-5 pb-6 text-base leading-relaxed text-ink-600 sm:px-6">
                    {item.answer}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
