import Link from "next/link";
import type { ReactNode } from "react";

/** The site's small component kit, the same look as the back office's
 * (apps/shop-web/src/components/ui.tsx and form-kit.tsx): monochrome panels,
 * inverse-ink primary actions, tokens only. Colour never comes from anywhere
 * else, which is what src/lib/colour-guard.test.ts enforces. `Button`,
 * `Field` and `Notice` keep shop-web's props (variants, tones, hint and
 * error) on purpose, even where this site does not use them yet, so the two
 * copies stay easy to compare. */

type Tone = "neutral" | "good" | "caution" | "danger" | "accent";

/** What every field shares; the two recipes below differ only in size. */
const FIELD_SHAPE =
  "rounded-md border border-line bg-panel font-normal text-ink placeholder:text-muted hover:border-line-strong";

export const INPUT = `${FIELD_SHAPE} min-h-9 px-2.5 py-1.5 text-sm max-sm:min-h-11 max-sm:text-base`;

/** The roomier field: 44px tall with 16px text at every width. A separate
 * recipe rather than `${INPUT} text-base`, because two font-size utilities on
 * one element are settled by stylesheet order, not by which comes last in the
 * class list. */
export const INPUT_LG = `${FIELD_SHAPE} min-h-11 px-3 py-2 text-base`;

const BUTTON_VARIANT = {
  primary: "border-transparent bg-inv text-inv-ink hover:opacity-90",
  secondary: "border-line bg-panel text-ink hover:border-line-strong hover:bg-panel-2",
  ghost: "border-transparent bg-transparent text-ink hover:bg-panel-2",
} as const;

/** The button's look as a class string, for elements that are not a
 * `<button>` (a link, or the upload step's file-picker label) but must look
 * like one. `Button` itself uses it, so the two cannot drift apart. */
export function buttonClass({
  variant = "secondary",
  block = false,
}: {
  variant?: keyof typeof BUTTON_VARIANT;
  block?: boolean;
} = {}): string {
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-5 text-[15px] font-semibold disabled:pointer-events-none disabled:opacity-50 ${BUTTON_VARIANT[variant]} ${block ? "w-full" : ""}`;
}

/** The site's one button. Primary is inverse ink (black on light, white on
 * dark). `block` fills the width, which is how the QR flow's main actions
 * look on a phone. */
export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  type = "button",
  block = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: keyof typeof BUTTON_VARIANT;
  type?: "button" | "submit";
  block?: boolean;
}): ReactNode {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={buttonClass({ variant, block })}
    >
      {children}
    </button>
  );
}

/** A label above its control, with an optional hint or error below. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}): ReactNode {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
      {error ? (
        <span role="alert" className="text-xs font-normal text-danger-fg">
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs font-normal text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

const NOTICE_TONE: Record<Tone, string> = {
  neutral: "border-line bg-panel-2 text-ink",
  good: "border-good/40 bg-good-soft text-ink",
  caution: "border-caution/40 bg-caution-soft text-ink",
  danger: "border-danger/40 bg-danger-soft text-danger-fg",
  accent: "border-accent/40 bg-accent-soft text-ink",
};

/** A tinted message box: something failed (danger), needs care (caution),
 * worked (good), or is worth knowing (accent). It sets no ARIA role itself:
 * whether a message interrupts a screen reader (`alert`), is read politely
 * (`status`) or is just there (`note`, or nothing) is the caller's decision,
 * and a box that guessed would start announcing messages that were quiet. */
export function Notice({
  tone = "accent",
  role,
  children,
  className = "",
}: {
  tone?: Tone;
  role?: "alert" | "status" | "note";
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div
      role={role}
      className={`rounded-md border px-3 py-2 text-sm ${NOTICE_TONE[tone]} ${className}`}
    >
      {children}
    </div>
  );
}

/** A plain surface for grouping. */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={`rounded-lg border border-line bg-panel p-5 shadow-panel ${className}`}>
      {children}
    </div>
  );
}

/** Mutually exclusive print options, drawn as segments. They are real radio
 * inputs (visually hidden inside each segment), so the form, the keyboard
 * (arrow keys move between options) and screen readers behave as they did
 * with the old radio list. */
export function ChoiceGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}): ReactNode {
  return (
    <fieldset className="grid min-w-0 gap-2">
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-[10px] bg-panel-2 p-1">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-10 cursor-pointer items-center justify-center rounded-[7px] px-3 text-center text-sm font-medium text-muted hover:text-ink has-[:checked]:bg-panel has-[:checked]:text-ink has-[:checked]:shadow-panel has-[:checked]:ring-1 has-[:checked]:ring-line-strong has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent-fg max-sm:min-h-11"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** An optional extra (finishing) as a chip. A real checkbox, visually hidden. */
export function ChipToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}): ReactNode {
  return (
    <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-line bg-panel px-4 text-sm font-medium text-ink hover:border-line-strong has-[:checked]:border-transparent has-[:checked]:bg-inv has-[:checked]:text-inv-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent-fg max-sm:min-h-11">
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      {label}
    </label>
  );
}

/** A number with minus and plus buttons around it, for counts like copies.
 * The input stays editable; the buttons clamp to `min`/`max`. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}): ReactNode {
  const noun = label.toLowerCase();
  const step = (delta: number): void => onChange(Math.min(max, Math.max(min, value + delta)));
  return (
    <div className="grid gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <div className="inline-flex w-fit items-center rounded-md border border-line bg-panel">
        <button
          type="button"
          aria-label={`Fewer ${noun}`}
          disabled={value <= min}
          onClick={() => step(-1)}
          className="grid size-11 place-items-center text-lg text-ink disabled:opacity-40"
        >
          −
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
          className="num h-11 w-16 border-x border-line bg-transparent text-center text-base"
        />
        <button
          type="button"
          aria-label={`More ${noun}`}
          disabled={value >= max}
          onClick={() => step(1)}
          className="grid size-11 place-items-center text-lg text-ink disabled:opacity-40"
        >
          +
        </button>
      </div>
    </div>
  );
}

/** The brand: a logo tile and the name, linking home. */
export function BrandMark(): ReactNode {
  return (
    <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 text-ink">
      <span className="grid size-8 place-items-center rounded-md bg-inv text-xs font-bold text-inv-ink">
        PA
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.01em]">Print Automated</span>
    </Link>
  );
}

/** Every page's frame: a slim header with the brand, the page, a footer line.
 * `width` is the content column: "narrow" for the QR flow's forms, "wide" for
 * the two information pages. */
export function SiteFrame({
  children,
  width = "wide",
}: {
  children: ReactNode;
  width?: "narrow" | "wide";
}): ReactNode {
  const column = width === "narrow" ? "max-w-xl" : "max-w-4xl";
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-panel">
        <div className={`mx-auto flex w-full items-center px-5 py-2 ${column}`}>
          <BrandMark />
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-5 py-8 sm:py-12 ${column}`}>{children}</main>
      <footer className="border-t border-line">
        <p className={`mx-auto w-full px-5 py-5 text-xs text-muted ${column}`}>
          Print Automated · Print from your phone, collect at the counter.
        </p>
      </footer>
    </div>
  );
}
