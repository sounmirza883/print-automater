import { cn } from "@/lib/cn";

export type MiniBarChartProps = {
  data: { label: string; value: number }[];
  /** Accessible summary of what the chart shows. */
  ariaLabel: string;
  /** Index of the bar to emphasise. */
  highlight?: number;
  className?: string;
};

/** Inline SVG bar chart; fluid width, fixed aspect. */
export function MiniBarChart({ data, ariaLabel, highlight, className }: MiniBarChartProps) {
  const W = 320;
  const H = 140;
  const padB = 22;
  const chartH = H - padB - 8;
  const max = Math.max(...data.map((d) => d.value), 1);
  const slot = W / data.length;
  const barW = slot * 0.56;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel}
      className={cn("h-auto w-full", className)}
    >
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <line
          key={t}
          x1={0}
          x2={W}
          y1={8 + chartH * (1 - t)}
          y2={8 + chartH * (1 - t)}
          stroke="#e6eaf3"
          strokeWidth={1}
        />
      ))}
      {data.map((d, i) => {
        const h = Math.max((d.value / max) * chartH, 2);
        const x = i * slot + (slot - barW) / 2;
        const y = 8 + chartH - h;
        const active = highlight === undefined || highlight === i;
        return (
          <g key={d.label}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              rx={3}
              fill={active ? "#2563eb" : "#93c5fd"}
            />
            <text
              x={x + barW / 2}
              y={H - 6}
              textAnchor="middle"
              fontSize={10}
              fill="#3b4870"
              fontFamily="var(--font-jetbrains-mono), monospace"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
