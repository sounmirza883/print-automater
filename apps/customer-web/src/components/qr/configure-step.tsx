"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  ColorMode,
  Finishing,
  Orientation,
  PaperSize,
  PaperType,
  Sides,
} from "@print-automated/types";
import type { PrintConfiguration } from "@print-automated/types";
import {
  Button,
  Card,
  ChipToggle,
  ChoiceGroup,
  Field,
  INPUT,
  INPUT_LG,
  Notice,
  SiteFrame,
  Stepper,
} from "@/components/ui";
import { OrderingFrom } from "@/components/qr/ordering-branch";
import { StepIndicator } from "@/components/qr/step-indicator";
import { validatePageSelection } from "@/lib/page-selection";
import type { PublicOrderResult } from "@/lib/public-order";

/** Where the QR wizard is. Lives beside `ConfigureStep` because that step
 * takes the three configure-shaped states as its prop and the page owns the
 * state machine over all of them. */
export type WizardStep =
  | { name: "details" }
  | { name: "upload" }
  | { name: "configure"; documentId: string; filename: string; pageCount: number | null }
  | { name: "submitting"; documentId: string; filename: string; pageCount: number | null }
  | {
      name: "submit-error";
      documentId: string;
      filename: string;
      pageCount: number | null;
      message: string;
    }
  | { name: "confirmed"; order: PublicOrderResult };

const PAPER_SIZES = Object.values(PaperSize);
const PAPER_TYPES = Object.values(PaperType);
// NONE isn't a real finishing option to tick -- it's just the schema's
// way of saying "no finishing at all," which an empty selection here
// already means (same filter shop-web's own pricing-view.ts applies).
const FINISHING_OPTIONS = Object.values(Finishing).filter((value) => value !== Finishing.NONE);

const FINISHING_LABELS: Record<string, string> = {
  STAPLING: "Stapling",
  BINDING: "Binding",
  CUTTING: "Cutting",
  LAMINATION: "Lamination",
};

const COLOR_OPTIONS: ReadonlyArray<{ value: PrintConfiguration["color"]; label: string }> = [
  { value: ColorMode.BW, label: "Black & white" },
  { value: ColorMode.COLOR, label: "Color" },
];

const SIDES_OPTIONS: ReadonlyArray<{ value: PrintConfiguration["sides"]; label: string }> = [
  { value: Sides.SINGLE, label: "Single-sided" },
  { value: Sides.DOUBLE, label: "Double-sided" },
];

const ORIENTATION_OPTIONS: ReadonlyArray<{
  value: PrintConfiguration["orientation"];
  label: string;
}> = [
  { value: Orientation.PORTRAIT, label: "Portrait" },
  { value: Orientation.LANDSCAPE, label: "Landscape" },
];

/** Step 3: the print-configuration fields. There is no shop to pick (the
 * URL fixes it) and no public quote endpoint to poll, so there is no live
 * price here. Submitting places the order directly; the price the guest sees
 * next is the real, already-computed one on the confirmation screen, not a
 * preview. */
export function ConfigureStep({
  step,
  onSubmit,
}: {
  step: Extract<WizardStep, { name: "configure" | "submitting" | "submit-error" }>;
  onSubmit: (config: PrintConfiguration) => void;
}): ReactNode {
  const [pagesMode, setPagesMode] = useState<"all" | "range">("all");
  const [rangeFrom, setRangeFrom] = useState(1);
  const [rangeTo, setRangeTo] = useState(step.pageCount ?? 1);
  const [copies, setCopies] = useState(1);
  const [paperSize, setPaperSize] = useState<PrintConfiguration["paperSize"]>(PaperSize.A4);
  const [paperType, setPaperType] = useState<PrintConfiguration["paperType"]>(PaperType.STANDARD);
  const [color, setColor] = useState<PrintConfiguration["color"]>(ColorMode.BW);
  const [sides, setSides] = useState<PrintConfiguration["sides"]>(Sides.SINGLE);
  const [orientation, setOrientation] = useState<PrintConfiguration["orientation"]>(
    Orientation.PORTRAIT,
  );
  const [finishing, setFinishing] = useState<Finishing[]>([]);

  const pages = useMemo<PrintConfiguration["pages"]>(
    () => (pagesMode === "all" ? { mode: "all" } : { mode: "range", from: rangeFrom, to: rangeTo }),
    [pagesMode, rangeFrom, rangeTo],
  );

  const pageError = step.pageCount != null ? validatePageSelection(pages, step.pageCount) : null;

  function toggleFinishing(value: Finishing): void {
    setFinishing((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  const isSubmitting = step.name === "submitting";

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pageError !== null || isSubmitting) return;
    onSubmit({
      pages,
      copies,
      paperSize,
      paperType,
      color,
      sides,
      orientation,
      finishing: finishing.length > 0 ? finishing : undefined,
    });
  }

  return (
    <SiteFrame width="narrow">
      <OrderingFrom />
      <StepIndicator current={3} />

      <div className="mb-6 grid gap-4">
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Choose print options</h1>
        <Card className="flex min-w-0 items-center gap-3 py-3">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-6 shrink-0 text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
          </svg>
          <p className="min-w-0 truncate text-sm font-medium">{step.filename}</p>
        </Card>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6">
        <div className="grid gap-3">
          <ChoiceGroup
            legend="Pages"
            name="pages"
            value={pagesMode}
            options={[
              {
                value: "all",
                label: `All pages${step.pageCount !== null ? ` (${step.pageCount})` : ""}`,
              },
              { value: "range", label: "Page range" },
            ]}
            onChange={setPagesMode}
          />
          {pagesMode === "range" && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={rangeFrom}
                onChange={(event) => setRangeFrom(Number(event.target.value))}
                className={`${INPUT} w-24`}
                aria-label="From page"
              />
              <span>to</span>
              <input
                type="number"
                min={1}
                value={rangeTo}
                onChange={(event) => setRangeTo(Number(event.target.value))}
                className={`${INPUT} w-24`}
                aria-label="To page"
              />
            </div>
          )}
          {pageError !== null && (
            <Notice tone="danger" role="alert">
              {pageError}
            </Notice>
          )}
        </div>

        <ChoiceGroup
          legend="Color"
          name="color"
          value={color}
          options={COLOR_OPTIONS}
          onChange={setColor}
        />

        <ChoiceGroup
          legend="Sides"
          name="sides"
          value={sides}
          options={SIDES_OPTIONS}
          onChange={setSides}
        />

        <ChoiceGroup
          legend="Orientation"
          name="orientation"
          value={orientation}
          options={ORIENTATION_OPTIONS}
          onChange={setOrientation}
        />

        <Stepper label="Copies" value={copies} min={1} max={500} onChange={setCopies} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Paper size">
            <select
              value={paperSize}
              onChange={(event) =>
                setPaperSize(event.target.value as PrintConfiguration["paperSize"])
              }
              className={INPUT_LG}
            >
              {PAPER_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Paper type">
            <select
              value={paperType}
              onChange={(event) =>
                setPaperType(event.target.value as PrintConfiguration["paperType"])
              }
              className={INPUT_LG}
            >
              {PAPER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.charAt(0) + type.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <fieldset className="grid min-w-0 gap-2">
          <legend className="mb-2 text-sm font-medium">Finishing (optional)</legend>
          <div className="flex flex-wrap gap-2">
            {FINISHING_OPTIONS.map((option) => (
              <ChipToggle
                key={option}
                label={FINISHING_LABELS[option] ?? option}
                checked={finishing.includes(option)}
                onChange={() => toggleFinishing(option)}
              />
            ))}
          </div>
        </fieldset>

        {/* On a phone this bar sticks to the bottom of the screen, so a guest
         * can place the order from anywhere on this long form. A refused order's
         * message lives inside the bar, right above the button they just
         * pressed; at the end of the form it would be a screen away. Sticky
         * rather than fixed: the bar settles after the last field instead of
         * covering it (or the footer). */}
        <div
          data-submit-bar
          className="grid gap-3 max-sm:sticky max-sm:bottom-0 max-sm:z-20 max-sm:-mx-5 max-sm:border-t max-sm:border-line max-sm:bg-surface/95 max-sm:px-5 max-sm:pt-3 max-sm:pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:backdrop-blur"
        >
          {step.name === "submit-error" && (
            <Notice tone="danger" role="alert">
              {step.message}
            </Notice>
          )}
          <Button
            type="submit"
            variant="primary"
            block
            disabled={pageError !== null || isSubmitting}
          >
            {isSubmitting ? "Placing order…" : "Place order"}
          </Button>
        </div>
      </form>
    </SiteFrame>
  );
}
