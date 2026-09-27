"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { columnLayout, columnPath, indexAt } from "@/lib/column-geometry";
import { labelledIndexes } from "@/lib/reports-view";

const HEIGHT = 220;
const GUTTERS = { left: 56, right: 8, top: 18, bottom: 28 };
/** Width used before the first measurement (and when rendered on the server). */
const FALLBACK_WIDTH = 640;

export interface ColumnDatum {
  /** The x label (e.g. "21 Sep"). */
  label: string;
  value: number;
}

/** 23.29: one series over time as thin columns in the accent hue (validated against both
 * chart surfaces). Hover or focus shows the period and its value; arrow keys move between
 * periods. Only the highest value is labelled on the chart; the report's table beside it
 * carries every value, so nothing depends on hovering. */
export function ColumnChart({
  title,
  subtitle,
  data,
  format,
  formatTick = format,
}: {
  title: string;
  subtitle?: string;
  data: readonly ColumnDatum[];
  /** The full value (tooltip, peak label, summary). */
  format: (value: number) => string;
  /** The y-axis ticks; compact, when the title or subtitle already names the unit. */
  formatTick?: (value: number) => string;
}): ReactNode {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const layout = columnLayout(
    data.map((datum) => datum.value),
    { width, height: HEIGHT },
    GUTTERS,
  );
  const highest = data.reduce(
    (best, datum, index) => (datum.value > (data[best]?.value ?? -Infinity) ? index : best),
    0,
  );
  const hasValue = data.some((datum) => datum.value > 0);
  // About one x label per 72px of plot, so labels never run into each other on a phone.
  const labelled = new Set(
    labelledIndexes(data.length, Math.max(2, Math.floor(layout.plot.width / 72))),
  );
  const current = active !== null ? layout.columns[active] : undefined;
  const currentDatum = active !== null ? data[active] : undefined;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (data.length === 0) return;
    const last = data.length - 1;
    const from = active ?? last;
    const next =
      event.key === "ArrowLeft"
        ? Math.max(0, from - 1)
        : event.key === "ArrowRight"
          ? Math.min(last, from + 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (event.key === "Escape") {
      setActive(null);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      setActive(next);
    }
  }

  const total = data.reduce((sum, datum) => sum + Math.max(0, datum.value), 0);
  const summary =
    data.length === 0
      ? `${title}: no periods in range.`
      : `${title}: ${data.length} periods, total ${format(total)}${
          hasValue ? `, highest ${format(data[highest]!.value)} (${data[highest]!.label})` : ""
        }. Use the arrow keys to read each period; the table below lists every value.`;

  return (
    <figure className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
      <figcaption>
        <span className="text-sm font-semibold tracking-tight">{title}</span>
        {subtitle !== undefined && <span className="ml-2 text-xs text-muted">{subtitle}</span>}
      </figcaption>
      <div
        ref={frameRef}
        tabIndex={0}
        role="group"
        aria-label={summary}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((value) => value ?? (data.length > 0 ? data.length - 1 : null))}
        onBlur={() => setActive(null)}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setActive(indexAt(layout, event.clientX - box.left));
        }}
        onPointerLeave={() => setActive(null)}
        className="relative w-full min-w-0 rounded-md outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
        style={{ height: HEIGHT }}
      >
        {/* Absolutely placed, so the drawing never sets the frame's width: the frame takes the
            page's width and the drawing is measured to fit it (no feedback loop on a phone). */}
        <svg
          width={width}
          height={HEIGHT}
          aria-hidden="true"
          className="absolute inset-0 overflow-visible"
        >
          {layout.ticks.map((tick) => (
            <g key={tick.value}>
              <line
                x1={layout.plot.left}
                x2={layout.plot.left + layout.plot.width}
                y1={tick.y}
                y2={tick.y}
                className="stroke-line"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={layout.plot.left - 8}
                y={tick.y}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted text-[11px] tabular-nums"
              >
                {formatTick(tick.value)}
              </text>
            </g>
          ))}
          {current !== undefined && (
            <rect
              x={current.cx - layout.slot / 2}
              y={layout.plot.top}
              width={layout.slot}
              height={layout.plot.height}
              className="fill-accent/10"
            />
          )}
          {layout.columns.map((column) => (
            <path key={column.index} d={columnPath(column)} className="fill-accent" />
          ))}
          {hasValue && active === null && layout.columns[highest] !== undefined && (
            <text
              x={layout.columns[highest]!.cx}
              y={layout.columns[highest]!.y - 6}
              textAnchor="middle"
              className="fill-ink text-[11px] font-medium tabular-nums"
            >
              {format(data[highest]!.value)}
            </text>
          )}
          {layout.columns.map((column) =>
            labelled.has(column.index) ? (
              <text
                key={column.index}
                x={column.cx}
                y={HEIGHT - 8}
                textAnchor={
                  column.index === 0 && data.length > 1
                    ? "start"
                    : column.index === data.length - 1 && data.length > 1
                      ? "end"
                      : "middle"
                }
                className="fill-muted text-[11px]"
              >
                {data[column.index]!.label}
              </text>
            ) : null,
          )}
        </svg>
        {current !== undefined && currentDatum !== undefined && (
          <div
            role="presentation"
            className="pointer-events-none absolute z-10 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs shadow-sm"
            style={{
              left: Math.min(Math.max(current.cx, 60), width - 60),
              top: Math.max(0, current.y - 52),
              transform: "translateX(-50%)",
            }}
          >
            <div className="text-sm font-semibold tabular-nums">{format(currentDatum.value)}</div>
            <div className="text-muted">{currentDatum.label}</div>
          </div>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {currentDatum !== undefined ? `${currentDatum.label}: ${format(currentDatum.value)}` : ""}
      </p>
    </figure>
  );
}
