import type { ColorMode } from "./enums/color-mode.js";
import type { Orientation } from "./enums/orientation.js";
import type { PaperSize } from "./enums/paper-size.js";
import type { Sides } from "./enums/sides.js";

/** All pages, or an inclusive 1-based page range (§16). */
export type PageSelection = { mode: "all" } | { mode: "range"; from: number; to: number };

/** The exact print configuration a customer chooses (§16). Persisted
 * verbatim on the order as `print_configuration` (§56) and snapshotted
 * alongside `pricing_snapshot` so a later shop repricing never changes
 * an existing order's total (§20). */
export interface PrintConfiguration {
  pages: PageSelection;
  copies: number;
  paperSize: PaperSize;
  color: ColorMode;
  sides: Sides;
  orientation: Orientation;
}
