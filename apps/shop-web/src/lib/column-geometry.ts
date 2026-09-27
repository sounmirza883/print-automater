import { niceTicks } from "@/lib/reports-view";

/** 23.29: geometry of a single-series column chart (the dataviz mark spec): columns grow
 * from one baseline, are at most 24px thick, leave at least a 2px surface gap between
 * neighbours, and have a 4px rounded data end (drawn by the component). Negative values are
 * not plotted (every series charted here is a count or an amount taken); they draw as zero. */

export const MAX_BAR = 24;
export const MIN_GAP = 2;

export interface ColumnLayout {
  /** Plot area inside the axis gutters. */
  plot: { left: number; top: number; width: number; height: number };
  ticks: Array<{ value: number; y: number }>;
  columns: Array<{
    index: number;
    /** Centre of the column's slot (where its x label and tooltip anchor go). */
    cx: number;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  slot: number;
}

export function columnLayout(
  values: readonly number[],
  size: { width: number; height: number },
  gutters: { left: number; right: number; top: number; bottom: number },
): ColumnLayout {
  const plot = {
    left: gutters.left,
    top: gutters.top,
    width: Math.max(1, size.width - gutters.left - gutters.right),
    height: Math.max(1, size.height - gutters.top - gutters.bottom),
  };
  const safe = values.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const ticks = niceTicks(Math.max(0, ...safe));
  const top = ticks[ticks.length - 1] as number;
  const scaleY = (value: number) => plot.top + plot.height - (value / top) * plot.height;
  const count = Math.max(1, safe.length);
  const slot = plot.width / count;
  const width = Math.max(1, Math.min(MAX_BAR, slot - Math.max(MIN_GAP, slot * 0.3)));
  return {
    plot,
    slot,
    ticks: ticks.map((value) => ({ value, y: scaleY(value) })),
    columns: safe.map((value, index) => {
      const cx = plot.left + slot * index + slot / 2;
      const y = scaleY(value);
      return {
        index,
        cx,
        x: cx - width / 2,
        y,
        width,
        height: plot.top + plot.height - y,
      };
    }),
  };
}

/** The slot under a pointer x (clamped), so hovering anywhere in a column's band - not only
 * on its painted pixels - selects it. */
export function indexAt(layout: ColumnLayout, x: number): number {
  const count = layout.columns.length;
  if (count === 0) return -1;
  const raw = Math.floor((x - layout.plot.left) / layout.slot);
  return Math.min(count - 1, Math.max(0, raw));
}

/** SVG path of a column with a rounded top (radius up to 4px) and a square baseline. */
export function columnPath(column: {
  x: number;
  y: number;
  width: number;
  height: number;
}): string {
  const { x, y, width, height } = column;
  if (height <= 0) return "";
  const r = Math.min(4, width / 2, height);
  const bottom = y + height;
  return [
    `M${x},${bottom}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${bottom}`,
    "Z",
  ].join(" ");
}
