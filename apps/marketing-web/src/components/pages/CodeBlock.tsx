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
    <figure className={cn("mt-4 overflow-hidden border border-ink-900 bg-ink-900", className)}>
      {label || language ? (
        <figcaption className="flex items-center justify-between border-b border-ink-700 px-4 py-2 font-mono text-xs text-ink-300">
          <span>{label}</span>
          <span>{language}</span>
        </figcaption>
      ) : null}
      <pre
        tabIndex={0}
        className="overflow-x-auto p-4 text-sm leading-6 text-ink-50 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink-50"
      >
        <code className="font-mono">{code}</code>
      </pre>
    </figure>
  );
}
