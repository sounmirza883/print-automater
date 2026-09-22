import type { ColorMode } from "./enums/color-mode.js";
import type { Finishing } from "./enums/finishing.js";
import type { Orientation } from "./enums/orientation.js";
import type { PaperSize } from "./enums/paper-size.js";
import type { PaperType } from "./enums/paper-type.js";
import type { Sides } from "./enums/sides.js";

/** All pages, or an inclusive 1-based page range (§16). */
export type PageSelection = { mode: "all" } | { mode: "range"; from: number; to: number };

/** The exact print configuration a customer chooses (§16). Persisted
 * verbatim on the order as `print_configuration` (§56) and snapshotted
 * alongside `pricing_snapshot` so a later shop repricing never changes
 * an existing order's total (§20).
 *
 * `paperType`/`finishing` are 15.1/§64 additions -- both optional so
 * every config persisted before this sub-phase still parses and
 * round-trips byte-identical; an absent value means today's implicit
 * "standard paper, no finishing" behaviour, not an unknown state.
 * packages/pricing's computeQuote() does not read either field yet
 * (Phase 17's job) -- the same "sides/orientation don't affect price"
 * invariant that package already asserts for itself. */
export interface PrintConfiguration {
  pages: PageSelection;
  copies: number;
  paperSize: PaperSize;
  paperType?: PaperType;
  color: ColorMode;
  sides: Sides;
  orientation: Orientation;
  finishing?: Finishing[];
}
