import { cn } from "@/lib/cn";

/** Dark code panel. Focusable so keyboard users can scroll long lines. */
export function CodeBlock({
  code,
  language,
  label,
  className,
}: {
  code: string;
  language?: string;
  label?: string;
  className?: string;
}) {
  return (
    <figure
      className={cn("mt-4 overflow-hidden rounded-xl border border-ink-800 bg-ink-950", className)}
    >
      {label || language ? (
        <figcaption className="flex items-center justify-between border-b border-ink-800 px-4 py-2 font-mono text-xs text-ink-200">
          <span>{label}</span>
          <span>{language}</span>
        </figcaption>
      ) : null}
      <pre
        tabIndex={0}
        className="overflow-x-auto p-4 text-sm leading-6 text-ink-50 outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <code className="font-mono">{code}</code>
      </pre>
    </figure>
  );
}
