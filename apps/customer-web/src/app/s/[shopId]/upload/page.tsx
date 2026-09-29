"use client";

import {
  use,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ColorMode,
  Finishing,
  Orientation,
  PaperSize,
  PaperType,
  Sides,
} from "@print-automated/types";
import type { PrintConfiguration } from "@print-automated/types";
import { createPublicOrderSchema } from "@print-automated/validation";
import { validatePageSelection } from "@/lib/page-selection";
import { formatMoney, summarizeConfiguration } from "@/lib/order-formatting";
import { createPublicOrder, type PublicOrderResult } from "@/lib/public-order";
import { runPublicUploadFlow, type PublicUploadState } from "@/lib/public-upload";

/** 24.1's QR landing page: a guest who scanned a shop's printed QR code
 * lands here with `:shopId` fixed by the URL -- there is no login, no
 * shop picker, and (per the backend's own accepted scope boundary,
 * Task 4) no live price preview: the guest picks print options blind
 * and sees the real total for the first time on the confirmation
 * screen below, from the just-placed order's own `pricingSnapshot`.
 * One page/wizard, not one route per step, matching the brief: there's
 * no account for a half-finished order to resume under. */
export default function QrOrderUploadPage({
  params,
}: {
  params: Promise<{ shopId: string }>;
}): ReactNode {
  const { shopId } = use(params);
  return <QrOrderWizard shopId={shopId} />;
}

type WizardStep =
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

function QrOrderWizard({ shopId }: { shopId: string }): ReactNode {
  const [step, setStep] = useState<WizardStep>({ name: "details" });
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  // Minted once per mount of this wizard, reused across a retry -- a
  // double-tap on "Place order" or a retry after a transient network
  // error must not place two orders (§92), same reasoning as
  // review/page.tsx's own idempotencyKey.
  const idempotencyKey = useRef(crypto.randomUUID());

  if (step.name === "details") {
    return (
      <GuestDetailsStep
        onContinue={(name, phone) => {
          setGuestName(name);
          setGuestPhone(phone);
          setStep({ name: "upload" });
        }}
      />
    );
  }

  if (step.name === "upload") {
    return (
      <UploadStep
        shopId={shopId}
        onReady={(documentId, filename, pageCount) =>
          setStep({ name: "configure", documentId, filename, pageCount })
        }
      />
    );
  }

  if (step.name === "confirmed") {
    return <ConfirmationScreen order={step.order} />;
  }

  return (
    <ConfigureStep
      step={step}
      onSubmit={(printConfiguration) => {
        const { documentId, filename, pageCount } = step;
        setStep({ name: "submitting", documentId, filename, pageCount });
        createPublicOrder(
          shopId,
          guestName,
          guestPhone,
          documentId,
          printConfiguration,
          idempotencyKey.current,
        )
          .then((order) => setStep({ name: "confirmed", order }))
          .catch((error: unknown) => {
            setStep({
              name: "submit-error",
              documentId,
              filename,
              pageCount,
              message: error instanceof Error ? error.message : "Could not place this order.",
            });
          });
      }}
    />
  );
}

/** Step 1: name + phone, no account. Validated with the exact same
 * `createPublicOrderSchema` (`@print-automated/validation`) the
 * backend runs against these two fields -- not a second, hand-rolled
 * copy of the phone-shape rule that could quietly drift from it, the
 * same "one rule, shared" reasoning `page-selection.ts`'s own
 * `validatePageSelection` already follows for page ranges. A rejection
 * here is worded identically to a server-side one (e.g. "Enter a phone
 * number of 7 to 15 digits."), so it's never a surprise later. */
function GuestDetailsStep({
  onContinue,
}: {
  onContinue: (name: string, phone: string) => void;
}): ReactNode {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = createPublicOrderSchema
      .pick({ name: true, phone: true })
      .safeParse({ name, phone });
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Check your details and try again.");
      return;
    }
    setError(null);
    onContinue(result.data.name, result.data.phone);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Print with this shop</h1>
        <p className="text-sm text-gray-600">
          No account needed. Just your name and phone number, so the shop can reach you about your
          order.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Your name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
            required
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Phone number</span>
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2"
            required
          />
        </label>

        {error !== null && (
          <p role="alert" style={{ color: "var(--color-error)" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          className="rounded-md px-4 py-2 font-semibold text-white"
          style={{ backgroundColor: "var(--color-primary-action)" }}
        >
          Continue
        </button>
      </form>
    </main>
  );
}

const BUSY_LABELS: Record<string, string> = {
  creating: "Preparing upload…",
  confirming: "Confirming…",
  processing: "Checking your document…",
};

/** Step 2: the same drag-and-drop/file-picker UX as `app/upload/page.tsx`,
 * pointed at the public upload flow instead. A 409 here (the first call
 * this whole page ever makes to the backend) is where a shop that
 * doesn't exist, isn't OPEN, or was given a malformed id first surfaces
 * -- there is no earlier "is this shop open" check to make, since
 * there's no public single-shop lookup route to make one against. */
function UploadStep({
  shopId,
  onReady,
}: {
  shopId: string;
  onReady: (documentId: string, filename: string, pageCount: number | null) => void;
}): ReactNode {
  const [state, setState] = useState<PublicUploadState>({ phase: "idle" });
  const [isDragging, setIsDragging] = useState(false);

  function handleFile(file: File): void {
    void runPublicUploadFlow(shopId, file, (next) => {
      setState(next);
      if (next.phase === "ready") {
        onReady(next.documentId, next.filename, next.pageCount);
      }
    });
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  }

  // "ready" never actually renders below -- onReady above moves the
  // wizard to the "configure" step in the same tick, unmounting this
  // component -- but it's still excluded here rather than left to fall
  // through to the generic "Working…" busy label.
  const isBusy = !["idle", "ready", "rejected", "error"].includes(state.phase);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-bold">Upload your document</h1>

      <div
        onDrop={handleDrop}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-16 text-center"
        style={{ borderColor: isDragging ? "var(--color-primary-action)" : "#d1d5db" }}
      >
        {isBusy ? (
          <UploadProgress state={state} />
        ) : (
          <>
            <p className="text-gray-600">Drag and drop a file here, or</p>
            <label
              className="cursor-pointer rounded-md px-4 py-2 font-semibold text-white"
              style={{ backgroundColor: "var(--color-primary-action)" }}
            >
              Choose a file
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png,.docx"
                className="hidden"
                onChange={handleFileInputChange}
              />
            </label>
            <p className="text-xs text-gray-500">PDF, JPEG, PNG, or Word (.docx), up to 25MB.</p>
          </>
        )}
      </div>

      {state.phase === "rejected" && (
        <div
          role="alert"
          className="rounded-md border p-4"
          style={{ borderColor: "var(--color-error)", color: "var(--color-error)" }}
        >
          <p className="font-semibold">{state.reason}</p>
        </div>
      )}

      {state.phase === "error" && (
        <div
          role="alert"
          className="rounded-md border p-4"
          style={{ borderColor: "var(--color-error)", color: "var(--color-error)" }}
        >
          <p>{state.message}</p>
        </div>
      )}
    </main>
  );
}

function UploadProgress({ state }: { state: PublicUploadState }): ReactNode {
  if (state.phase === "uploading") {
    return (
      <div className="flex flex-col items-center gap-2">
        <p>Uploading…</p>
        <p className="text-sm text-gray-600">{state.progress}%</p>
      </div>
    );
  }
  return <p>{BUSY_LABELS[state.phase] ?? "Working…"}</p>;
}

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

/** Step 3: the print-configuration fields from `app/configure/page.tsx`,
 * minus its shop-matching and live-quote logic (there's no shop to pick
 * -- it's fixed by the URL -- and no public quote endpoint to poll,
 * §per the brief). Submitting places the order directly; the price the
 * guest sees next is the real, already-computed one on the confirmation
 * screen, not a preview. */
function ConfigureStep({
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
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-bold">Choose print options</h1>
      <p className="text-sm text-gray-600">{step.filename}</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">Pages</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={pagesMode === "all"}
              onChange={() => setPagesMode("all")}
            />
            All pages{step.pageCount !== null ? ` (${step.pageCount})` : ""}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={pagesMode === "range"}
              onChange={() => setPagesMode("range")}
            />
            Page range
          </label>
          {pagesMode === "range" && (
            <div className="flex items-center gap-2 pl-6">
              <input
                type="number"
                min={1}
                value={rangeFrom}
                onChange={(event) => setRangeFrom(Number(event.target.value))}
                className="w-20 rounded-md border border-gray-300 px-2 py-1"
                aria-label="From page"
              />
              <span>to</span>
              <input
                type="number"
                min={1}
                value={rangeTo}
                onChange={(event) => setRangeTo(Number(event.target.value))}
                className="w-20 rounded-md border border-gray-300 px-2 py-1"
                aria-label="To page"
              />
            </div>
          )}
          {pageError !== null && (
            <p role="alert" className="text-sm" style={{ color: "var(--color-error)" }}>
              {pageError}
            </p>
          )}
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className="font-semibold">Copies</span>
          <input
            type="number"
            min={1}
            max={500}
            value={copies}
            onChange={(event) => setCopies(Number(event.target.value))}
            className="w-24 rounded-md border border-gray-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold">Paper size</span>
          <select
            value={paperSize}
            onChange={(event) =>
              setPaperSize(event.target.value as PrintConfiguration["paperSize"])
            }
            className="w-40 rounded-md border border-gray-300 px-2 py-1"
          >
            {PAPER_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-semibold">Paper type</span>
          <select
            value={paperType}
            onChange={(event) =>
              setPaperType(event.target.value as PrintConfiguration["paperType"])
            }
            className="w-40 rounded-md border border-gray-300 px-2 py-1"
          >
            {PAPER_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.charAt(0) + type.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">Color</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={color === ColorMode.BW}
              onChange={() => setColor(ColorMode.BW)}
            />
            Black &amp; white
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={color === ColorMode.COLOR}
              onChange={() => setColor(ColorMode.COLOR)}
            />
            Color
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">Sides</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={sides === Sides.SINGLE}
              onChange={() => setSides(Sides.SINGLE)}
            />
            Single-sided
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={sides === Sides.DOUBLE}
              onChange={() => setSides(Sides.DOUBLE)}
            />
            Double-sided
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">Orientation</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={orientation === Orientation.PORTRAIT}
              onChange={() => setOrientation(Orientation.PORTRAIT)}
            />
            Portrait
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={orientation === Orientation.LANDSCAPE}
              onChange={() => setOrientation(Orientation.LANDSCAPE)}
            />
            Landscape
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">Finishing (optional)</legend>
          {FINISHING_OPTIONS.map((option) => (
            <label key={option} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={finishing.includes(option)}
                onChange={() => toggleFinishing(option)}
              />
              {FINISHING_LABELS[option] ?? option}
            </label>
          ))}
        </fieldset>

        {step.name === "submit-error" && (
          <p role="alert" style={{ color: "var(--color-error)" }}>
            {step.message}
          </p>
        )}

        <button
          type="submit"
          disabled={pageError !== null || isSubmitting}
          className="rounded-md bg-black px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {isSubmitting ? "Placing order…" : "Place order"}
        </button>
      </form>
    </main>
  );
}

/** Step 4: the guest's own order number -- "the order number" the brief
 * refers to -- plus the real total, seen here for the first time (no
 * quote preview exists earlier in this flow). No link onward: there is
 * no account/session for this guest to track the order under, so this
 * screen is the end of the road for this page, same as the brief's
 * "no account to resume a half-finished order under" framing implies
 * for the finished one too. */
function ConfirmationScreen({ order }: { order: PublicOrderResult }): ReactNode {
  const quote = order.pricingSnapshot.quote;
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 px-6 py-12">
      <div role="status" className="flex flex-col gap-2 rounded-md border border-gray-300 p-4">
        <p className="text-sm text-gray-600">Order placed</p>
        <h1 className="text-2xl font-bold">{order.publicOrderNumber}</h1>
        <p className="text-gray-600">{order.shopName}</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-gray-500">Document</dt>
        <dd>{order.documentFilename}</dd>
        <dt className="text-gray-500">Configuration</dt>
        <dd>{summarizeConfiguration(order.printConfiguration)}</dd>
      </dl>

      <div className="flex flex-col gap-2 rounded-lg border border-gray-300 p-4">
        <ul className="flex flex-col gap-1 text-sm">
          {quote.lineItems.map((item) => (
            <li key={item.label} className="flex justify-between">
              <span>{item.label}</span>
              <span>{formatMoney(item.amountMinor, quote.currency)}</span>
            </li>
          ))}
          <li className="flex justify-between">
            <span>Platform fee</span>
            <span>{formatMoney(quote.platformFeeMinor, quote.currency)}</span>
          </li>
        </ul>
        <div className="flex justify-between border-t border-gray-300 pt-2 font-semibold">
          <span>Total</span>
          <span>{formatMoney(quote.totalMinor, quote.currency)}</span>
        </div>
      </div>

      <p className="text-sm text-gray-600">
        Show this order number to the shop when you collect your prints.
      </p>
    </main>
  );
}
