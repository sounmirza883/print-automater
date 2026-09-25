"use client";

import { useEffect, useState } from "react";
import { headerCtas, primaryNav } from "@/content/navigation";
import { siteConfig } from "@/content/site";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { MobileNav } from "./MobileNav";

/** Sticky, blurred dark bar (pairs with the dark hero band). */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 h-16 border-b transition-colors",
        scrolled
          ? "border-white/10 bg-ink-950/85 backdrop-blur-lg"
          : "border-transparent bg-ink-950/60 backdrop-blur-sm",
      )}
    >
      <Container className="flex h-full items-center justify-between gap-6">
        <a
          href="/"
          className="flex items-center gap-2 text-base font-semibold text-white"
          aria-label={`${siteConfig.name} home`}
        >
          <span aria-hidden="true" className="flex gap-0.5">
            <span className="size-2 rounded-full bg-cmyk-cyan" />
            <span className="size-2 rounded-full bg-cmyk-magenta" />
            <span className="size-2 rounded-full bg-cmyk-yellow" />
          </span>
          {siteConfig.name}
        </a>
        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {primaryNav.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="rounded-md px-3 py-2 text-sm text-ink-100 transition-colors hover:bg-white/10 hover:text-white"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <Button href={headerCtas.login.href} variant="ghost" tone="dark" size="sm">
            {headerCtas.login.label}
          </Button>
          <Button href={headerCtas.primary.href} size="sm">
            {headerCtas.primary.label}
          </Button>
        </div>
        <MobileNav />
      </Container>
    </header>
  );
}
