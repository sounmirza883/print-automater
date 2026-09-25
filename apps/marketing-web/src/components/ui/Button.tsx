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

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:pointer-events-none disabled:opacity-50";

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

function variantClasses(variant: ButtonVariant, tone: ButtonTone): string {
  if (variant === "primary") {
    return "bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800";
  }
  if (variant === "secondary") {
    return tone === "dark"
      ? "border border-white/25 bg-white/5 text-white hover:bg-white/10"
      : "border border-ink-200 bg-white text-ink-900 hover:bg-ink-50";
  }
  return tone === "dark"
    ? "text-ink-100 hover:bg-white/10 hover:text-white"
    : "text-ink-700 hover:bg-ink-100 hover:text-ink-900";
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
