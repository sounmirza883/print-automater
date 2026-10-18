import { cn } from "@/lib/cn";

export type MiniBarChartProps = {
  /** `value: null` marks a slot with no data yet (e.g. later days this week). */
  data: { label: string; value: number | null }[];
  /** Accessible summary of what the chart shows. */
  ariaLabel: string;
  /** Index of the bar to emphasise; its value is printed above it. */
  highlight?: number;
  className?: string;
};

const fmt = (n: number) => n.toLocaleString("en-US");

/** Inline SVG bar chart; fluid width, fixed aspect. */
export function MiniBarChart({ data, ariaLabel, highlight, className }: MiniBarChartProps) {
  const W = 320;
  const H = 140;
  const padT = 20;
  const padB = 22;
  const chartH = H - padB - padT;
  const max = Math.max(...data.map((d) => d.value ?? 0), 1);
  const slot = W / data.length;
  const barW = slot * 0.56;
  const baseY = padT + chartH;

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
          y1={padT + chartH * (1 - t)}
          y2={padT + chartH * (1 - t)}
          stroke="#d4d3d0"
          strokeWidth={1}
        />
      ))}
      {data.map((d, i) => {
        const x = i * slot + (slot - barW) / 2;
        const cx = x + barW / 2;
        const label = (
          <text
            x={cx}
            y={H - 6}
            textAnchor="middle"
            fontSize={10}
            fill={d.value === null ? "#989797" : "#4b4b4d"}
            fontWeight={highlight === i ? 600 : 400}
            fontFamily="var(--font-geist-mono), monospace"
          >
            {d.label}
          </text>
        );
        if (d.value === null) {
          // No data yet: a dashed stub on the baseline instead of a bar.
          return (
            <g key={d.label}>
              <line
                x1={x}
                x2={x + barW}
                y1={baseY - 1}
                y2={baseY - 1}
                stroke="#989797"
                strokeWidth={2}
                strokeDasharray="3 3"
              />
              {label}
            </g>
          );
        }
        const h = Math.max((d.value / max) * chartH, 2);
        const y = baseY - h;
        const emphasised = highlight === i;
        const active = highlight === undefined || emphasised;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barW} height={h} fill={active ? "#101014" : "#bab9b7"} />
            {emphasised ? (
              <text
                x={cx}
                y={y - 6}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill="#000000"
                fontFamily="var(--font-geist-mono), monospace"
              >
                {fmt(d.value)}
              </text>
            ) : null}
            {label}
          </g>
        );
      })}
    </svg>
  );
}
