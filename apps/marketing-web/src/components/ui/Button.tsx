import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";
export type ButtonTone = "light" | "dark";

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Surface the button sits on; affects secondary/ghost colours. */
  tone?: ButtonTone;
  fullWidth?: boolean;
  children?: ReactNode;
};

type AnchorProps = Common & { href: string } & Omit<
    AnchorHTMLAttributes<HTMLAnchorElement>,
    "href"
  >;
type NativeButtonProps = Common & { href?: undefined } & ButtonHTMLAttributes<HTMLButtonElement>;

export type ButtonProps = AnchorProps | NativeButtonProps;

// Every variant carries a 1px border so the hover inversion never shifts the layout.
const base =
  "inline-flex items-center justify-center gap-2 border font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50";

// md and lg meet the 48px touch target.
const sizes: Record<ButtonSize, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-12 px-6 text-base",
  lg: "h-14 px-8 text-base",
};

/** Primary is charcoal on cream and inverts on hover; secondary is cream with a grey
 * rule and fills charcoal on hover. "dark" tone flips both for charcoal bands. */
function variantClasses(variant: ButtonVariant, tone: ButtonTone): string {
  const dark = tone === "dark";
  if (variant === "primary") {
    return dark
      ? "border-ink-50 bg-ink-50 text-ink-900 hover:bg-transparent hover:text-ink-50"
      : "border-ink-900 bg-ink-900 text-ink-50 hover:bg-ink-50 hover:text-ink-900";
  }
  if (variant === "secondary") {
    return dark
      ? "border-ink-400 bg-transparent text-ink-50 hover:border-ink-50 hover:bg-ink-50 hover:text-ink-900"
      : "border-ink-400 bg-ink-50 text-ink-900 hover:border-ink-900 hover:bg-ink-900 hover:text-ink-50";
  }
  return dark
    ? "border-transparent text-ink-100 hover:text-ink-50 hover:underline"
    : "border-transparent text-ink-950 hover:underline";
}

/** Renders <a> when `href` is set, otherwise <button type="button"> by default. */
export function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    const { variant, size, tone, fullWidth, className, children, ...anchor } = props;
    return (
      <a {...anchor} className={buttonClasses({ variant, size, tone, fullWidth, className })}>
        {children}
      </a>
    );
  }
  const { variant, size, tone, fullWidth, className, children, type, ...btn } = props;
  return (
    <button
      {...btn}
      type={type ?? "button"}
      className={buttonClasses({ variant, size, tone, fullWidth, className })}
    >
      {children}
    </button>
  );
}

function buttonClasses(o: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  tone?: ButtonTone;
  fullWidth?: boolean;
  className?: string;
}): string {
  return cn(
    base,
    sizes[o.size ?? "md"],
    variantClasses(o.variant ?? "primary", o.tone ?? "light"),
    o.fullWidth && "w-full",
    o.className,
  );
}
