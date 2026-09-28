import type { ReactNode } from "react";
import type { Tone } from "@/lib/job-status";
import { formatCount } from "@/lib/format";

interface Segment {
  label: string;
  value: number;
  tone: Tone;
  href: string;
}

const TONE_FILL: Record<Tone, string> = {
  neutral: "fill-quiet",
  good: "fill-good",
  caution: "fill-caution",
  danger: "fill-danger",
  accent: "fill-accent",
};

const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-quiet",
  good: "bg-good",
  caution: "bg-caution",
  danger: "bg-danger",
  accent: "bg-accent",
};

const BAR_HEIGHT = 20;
const GAP = 2;
const RADIUS = 4;

/** 27.5 (dataviz skill): the order-status mix as one proportional bar, mark spec exactly --
 * <=24px thick, 4px rounded ends (square where segments touch), a 2px surface gap between
 * segments (never a stroke), a legend with visible counts since this is 2+ series. These are
 * STATUS colors (good/caution/danger/accent/neutral), not a generated categorical palette --
 * the skill's own color-formula scopes its six-check validator to categorical (identity)
 * palettes only; a fixed, reserved status scale is exempt by design, and this app's `Tone`
 * scale (dashboard-view.ts's own GROUP_TONES) is already the one every other status pill and
 * bar in this console uses, so introducing a second, parallel palette here would be the
 * anti-pattern, not the fix. Text stays in text tokens throughout; only the fill carries color. */
export function StackedStatusBar({
  segments,
  ariaLabel,
}: {
  segments: Segment[];
  ariaLabel: string;
}): ReactNode {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const visible = segments.filter((segment) => segment.value > 0);

  if (total === 0) {
    return (
      <div>
        <div
          role="img"
          aria-label={`${ariaLabel}: nothing yet`}
          className="h-5 w-full rounded-full bg-panel-2"
        />
        <p className="mt-2 text-xs text-muted">Nothing yet.</p>
      </div>
    );
  }

  // Cumulative x offsets computed functionally (no mutation across the
  // iteration): each entry's x is the running total of every width before it.
  const positioned = visible.reduce<Array<{ segment: Segment; x: number; width: number }>>(
    (acc, segment) => {
      const width = (segment.value / total) * 100;
      const previous = acc[acc.length - 1];
      const x = previous === undefined ? 0 : previous.x + previous.width;
      return [...acc, { segment, x, width }];
    },
    [],
  );

  return (
    <div>
      <svg
        role="img"
        aria-label={`${ariaLabel}: ${visible.map((s) => `${s.label} ${s.value}`).join(", ")}`}
        viewBox={`0 0 100 ${BAR_HEIGHT}`}
        width="100%"
        height={BAR_HEIGHT}
        preserveAspectRatio="none"
      >
        {/* A flat track first, so a segment's own square inner edges never show a gap
            of the wrong color -- only the 2px gaps between segments cut through to it. */}
        <rect x={0} y={0} width="100%" height={BAR_HEIGHT} rx={RADIUS} className="fill-panel-2" />
        {positioned.map(({ segment, x, width }, index) => (
          <rect
            key={segment.label}
            x={`${x}%`}
            y={0}
            width={`${Math.max(width - (index === positioned.length - 1 ? 0 : GAP / 4), 0)}%`}
            height={BAR_HEIGHT}
            rx={RADIUS}
            className={TONE_FILL[segment.tone]}
          />
        ))}
      </svg>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {segments.map((segment) => (
          <li key={segment.label}>
            <a href={segment.href} className="flex items-center gap-1.5 hover:underline">
              <span
                aria-hidden="true"
                className={`size-2.5 shrink-0 rounded-full ${TONE_DOT[segment.tone]}`}
              />
              <span className="text-muted">{segment.label}</span>
              <span className="num font-medium">{formatCount(segment.value)}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
