import {
  Calculator,
  Clock,
  FileWarning,
  MessageCircle,
  ShieldCheck,
  Store,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Card, IconTile, Reveal, Section, SectionHeader } from "@/components/ui";

const problems: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: FileWarning,
    title: "Files on USB sticks",
    text: "Files arrive on a stranger's drive, get lost, or turn out to be the wrong version.",
  },
  {
    icon: MessageCircle,
    title: "Orders buried in WhatsApp",
    text: "Requirements scatter across chats, and nobody is sure which message is final.",
  },
  {
    icon: Calculator,
    title: "Quotes done by hand",
    text: "Every price is worked out on a calculator, so two staff quote two different amounts.",
  },
  {
    icon: Clock,
    title: "Idle and overloaded printers",
    text: "One machine sits waiting while another has a queue of twenty jobs.",
  },
];

const audiences: { icon: LucideIcon; who: string; text: string }[] = [
  {
    icon: Store,
    who: "Shop owners",
    text: "See revenue, stock and printer use without asking around.",
  },
  {
    icon: UserRound,
    who: "Counter staff",
    text: "Take orders, collect payment and hand over finished work.",
  },
  {
    icon: Wrench,
    who: "Operators",
    text: "Work from one live queue and fix problems at the machine.",
  },
  {
    icon: Users,
    who: "Customers",
    text: "Order from anywhere, know the price, and track their job.",
  },
];

export function Overview() {
  return (
    <Section id="overview" tone="light">
      <SectionHeader
        id="overview"
        eyebrow="Overview"
        title="Stop running your print shop from chat threads and USB sticks"
        lede="Print Automated replaces the scramble between counter, files and machines with one system. Customers order online, jobs go to the right printer, and your team stays in control."
      />

      <div className="mt-14 grid gap-6 lg:grid-cols-5">
        <Reveal className="lg:col-span-3">
          <h3 className="text-lg font-semibold text-ink-900">The problem today</h3>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {problems.map((p) => (
              <li key={p.title}>
                <Card interactive className="h-full">
                  <IconTile icon={p.icon} size="sm" />
                  <h4 className="mt-4 font-semibold text-ink-900">{p.title}</h4>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{p.text}</p>
                </Card>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={100} className="lg:col-span-2">
          <div className="relative h-full overflow-hidden rounded-2xl bg-ink-950 p-7 text-white">
            <div
              aria-hidden="true"
              className="absolute -right-10 -top-10 size-40 rounded-full bg-brand-600/30 blur-3xl"
            />
            <IconTile icon={ShieldCheck} tone="dark" />
            <h3 className="mt-5 text-lg font-semibold">The Print Automated way</h3>
            <p className="mt-3 leading-relaxed text-ink-200">
              An order is placed, priced from your own price list, paid, and routed to a printer
              that can do the job. Operators watch progress, stock is deducted as paper is used, and
              the customer is told when to collect.
            </p>
            <p className="mt-4 leading-relaxed text-ink-200">
              Automation handles the routine. Authorized staff can pause, reassign or switch it off
              at any time.
            </p>
          </div>
        </Reveal>
      </div>

      <Reveal className="mt-16">
        <h3 className="text-center text-lg font-semibold text-ink-900">
          Built for everyone in the shop
        </h3>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {audiences.map((a) => (
            <li
              key={a.who}
              className="group flex items-start gap-4 rounded-2xl border border-ink-100 bg-ink-50 p-5 transition-colors hover:border-brand-200 hover:bg-brand-50"
            >
              <IconTile icon={a.icon} size="sm" tone="brand" />
              <div>
                <p className="font-semibold text-ink-900">{a.who}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-600">{a.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Reveal>
    </Section>
  );
}
