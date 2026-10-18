import { headerCtas, primaryNav } from "@/content/navigation";
import { siteConfig } from "@/content/site";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { MobileNav } from "./MobileNav";

/** A sheet of paper, stacked: an outlined square behind a solid one. */
function LogoMark() {
  return (
    <span aria-hidden="true" className="relative block size-5 shrink-0">
      <span className="absolute inset-0 translate-x-0.5 translate-y-0.5 border border-ink-950" />
      <span className="absolute inset-0 -translate-x-0.5 -translate-y-0.5 bg-ink-950" />
    </span>
  );
}

/** Sticky cream bar with a grey rule: it reads as part of the page, not a layer on it. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 h-16 border-b border-ink-400 bg-ink-50">
      <Container className="flex h-full items-center justify-between gap-6">
        <a
          href="/"
          className="flex h-12 items-center gap-3 font-display text-lg font-bold text-ink-950"
          aria-label={`${siteConfig.name} home`}
        >
          <LogoMark />
          {siteConfig.name}
        </a>
        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {primaryNav.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="px-3 py-2 text-sm font-medium text-ink-950 hover:underline hover:underline-offset-4"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Button href={headerCtas.login.href} variant="primary" size="sm">
            {headerCtas.login.label}
          </Button>
        </div>
        <MobileNav />
      </Container>
    </header>
  );
}
