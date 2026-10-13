import type { ReactNode } from "react";

/** The frame shared by the three signed-out pages (sign in, set up account,
 * accept invitation): a brand panel beside the form from `lg` up, the form
 * alone below it. The panel uses the `brand` tokens, which stay dark in both
 * themes; with `inv` it turned white in dark mode and lit up most of the
 * screen. It is decoration, so it is hidden from assistive tech. */
export function AuthFrame({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro: ReactNode;
  /** The form. */
  children: ReactNode;
  /** Links to the other signed-out pages. */
  footer?: ReactNode;
}): ReactNode {
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
      <section
        aria-hidden="true"
        className="hidden flex-col justify-between border-r border-line bg-brand p-12 text-brand-ink/70 lg:flex"
      >
        <div className="flex items-center gap-3 text-brand-ink">
          <span className="grid size-9 place-items-center rounded-md bg-brand-ink text-sm font-bold text-brand">
            PA
          </span>
          <span className="text-lg font-semibold tracking-tight">Print Automated</span>
        </div>
        <div className="max-w-md">
          <p className="text-3xl leading-tight font-semibold tracking-tight text-brand-ink">
            The whole floor, on one screen.
          </p>
          <p className="mt-4 text-base">
            Orders, printers, paper and people, with the things that need a human called out first.
          </p>
        </div>
        <p className="num text-xs">Queue &middot; Printers &middot; Stock &middot; Reports</p>
      </section>

      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto flex w-full max-w-md flex-col gap-6 lg:mx-0 lg:max-w-none">
          <span className="grid size-9 place-items-center rounded-md bg-inv text-sm font-bold text-inv-ink lg:hidden">
            PA
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 text-muted">{intro}</p>
          </div>
          {children}
          {footer !== undefined && (
            <div className="flex flex-col gap-2 text-sm text-muted">{footer}</div>
          )}
        </div>
      </section>
    </main>
  );
}
