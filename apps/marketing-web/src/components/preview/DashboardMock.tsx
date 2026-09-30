import { AppShell, StaticNav } from "./AppShell";
import { OverviewView } from "./views";

/**
 * The shop dashboard's Overview screen, non-interactive, for the hero.
 * Same shell and screen as the interactive product preview, so the two never
 * drift apart. Pure presentation; wrap in aria-hidden where decorative.
 */
export function DashboardMock({ className }: { className?: string }) {
  return (
    <AppShell nav={<StaticNav active="overview" />} className={className}>
      <OverviewView />
    </AppShell>
  );
}
