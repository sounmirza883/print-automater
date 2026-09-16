import { ColorMode, Orientation, Sides, type PrintConfiguration } from "@print-automated/types";

/** §9.9's own settings table, translated to SumatraPDF's
 * `-print-settings` comma-separated token syntax
 * (https://www.sumatrapdfreader.org/docs/Command-line-arguments):
 *
 * | Config | token |
 * |---|---|
 * | pages: range | `from-to` |
 * | pages: all | (omitted -- Sumatra's own default) |
 * | copies > 1 | `Nx` |
 * | copies === 1 | (omitted -- Sumatra's own default) |
 * | sides: double | `duplexlong`, or `duplexshort` if landscape |
 * | sides: single | (omitted -- Sumatra's own default) |
 * | color: BW | `monochrome` |
 * | color: COLOR | (omitted -- Sumatra's own default) |
 * | paperSize | `paper=<size>` (always) |
 * | orientation | `portrait` / `landscape` (always, both directions) |
 * | -- | `noscale` (always) |
 *
 * Only genuine deviations from Sumatra's own defaults are ever
 * emitted -- an omitted token is a deliberate choice mirrored in the
 * table above, not a gap. */
export function buildPrintSettings(config: PrintConfiguration): string {
  const parts: string[] = [];

  if (config.pages.mode === "range") {
    parts.push(`${config.pages.from}-${config.pages.to}`);
  }

  if (config.copies > 1) {
    parts.push(`${config.copies}x`);
  }

  if (config.sides === Sides.DOUBLE) {
    parts.push(config.orientation === Orientation.LANDSCAPE ? "duplexshort" : "duplexlong");
  }

  if (config.color === ColorMode.BW) {
    parts.push("monochrome");
  }

  parts.push(`paper=${config.paperSize}`);
  parts.push(config.orientation === Orientation.LANDSCAPE ? "landscape" : "portrait");
  parts.push("noscale");

  return parts.join(",");
}
