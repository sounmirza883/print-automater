import type {
  PaymentReportCurrency,
  PaymentReportPeriod,
  PaymentReportResponse,
} from "@print-automated/types";
import { bucketKeys, bucketStart } from "../reports/buckets.js";

/** Admin payment report: how much plan money was received (approved proofs) and not accepted
 * (rejected proofs) over a range. Pure -- the service only fetches rows -- so the rules that
 * matter (which date a payment counts on, per-currency totals, zero-filled periods, the viewer's
 * own day boundaries) are unit-tested on their own. */

export type PaymentReportGroupBy = "day" | "month";

export interface ReportProof {
  status: "PENDING" | "APPROVED" | "REJECTED";
  amountMinor: number;
  currency: string;
  planName: string;
  shopName: string;
  transactionRef: string;
  grantedMonths: number | null;
  rejectionReason: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Ranges of up to this many days are reported per day, longer ones per month. */
export const AUTO_DAILY_MAX_DAYS = 62;

export function chooseGroupBy(
  from: Date,
  to: Date,
  requested: PaymentReportGroupBy | undefined,
): PaymentReportGroupBy {
  if (requested !== undefined) {
    return requested;
  }
  return (to.getTime() - from.getTime()) / DAY_MS <= AUTO_DAILY_MAX_DAYS ? "day" : "month";
}

/** The moment a proof counts on: when it was decided (money received / not accepted), or, while
 * it is still waiting, when it was submitted. */
export function effectiveDate(proof: ReportProof): Date {
  return proof.status === "PENDING" ? proof.createdAt : (proof.reviewedAt ?? proof.createdAt);
}

/** The viewer's wall clock as a UTC date: shifting by their offset lets UTC bucketing produce
 * THEIR days and months. */
function shifted(date: Date, tzOffsetMinutes: number): Date {
  return new Date(date.getTime() + tzOffsetMinutes * MINUTE_MS);
}

function emptyPeriod(period: string): PaymentReportPeriod {
  return { period, receivedMinor: 0, receivedCount: 0, rejectedMinor: 0, rejectedCount: 0 };
}

export function buildPaymentReport(
  proofs: readonly ReportProof[],
  options: { from: Date; to: Date; groupBy: PaymentReportGroupBy; tzOffsetMinutes: number },
): PaymentReportResponse {
  const { from, to, groupBy, tzOffsetMinutes } = options;
  const keys = bucketKeys(
    shifted(from, tzOffsetMinutes),
    shifted(new Date(to.getTime() - 1), tzOffsetMinutes),
    groupBy,
  );

  const byCurrency = new Map<
    string,
    {
      block: PaymentReportCurrency;
      periods: Map<string, PaymentReportPeriod>;
      plans: Map<string, { minor: number; count: number }>;
    }
  >();
  function blockFor(currency: string) {
    let entry = byCurrency.get(currency);
    if (entry === undefined) {
      const periods = new Map(keys.map((key) => [key, emptyPeriod(key)] as const));
      entry = {
        block: {
          currency,
          receivedMinor: 0,
          receivedCount: 0,
          rejectedMinor: 0,
          rejectedCount: 0,
          waitingMinor: 0,
          waitingCount: 0,
          periods: [],
          byPlan: [],
        },
        periods,
        plans: new Map(),
      };
      byCurrency.set(currency, entry);
    }
    return entry;
  }

  for (const proof of proofs) {
    const at = effectiveDate(proof);
    if (at < from || at >= to) {
      continue;
    }
    const entry = blockFor(proof.currency);
    if (proof.status === "PENDING") {
      entry.block.waitingMinor += proof.amountMinor;
      entry.block.waitingCount += 1;
      continue;
    }
    const period = entry.periods.get(bucketStart(shifted(at, tzOffsetMinutes), groupBy));
    if (proof.status === "APPROVED") {
      entry.block.receivedMinor += proof.amountMinor;
      entry.block.receivedCount += 1;
      if (period) {
        period.receivedMinor += proof.amountMinor;
        period.receivedCount += 1;
      }
      const plan = entry.plans.get(proof.planName) ?? { minor: 0, count: 0 };
      plan.minor += proof.amountMinor;
      plan.count += 1;
      entry.plans.set(proof.planName, plan);
    } else {
      entry.block.rejectedMinor += proof.amountMinor;
      entry.block.rejectedCount += 1;
      if (period) {
        period.rejectedMinor += proof.amountMinor;
        period.rejectedCount += 1;
      }
    }
  }

  const currencies = [...byCurrency.values()].map(({ block, periods, plans }) => ({
    ...block,
    periods: [...periods.values()],
    byPlan: [...plans.entries()]
      .map(([planName, value]) => ({
        planName,
        receivedMinor: value.minor,
        receivedCount: value.count,
      }))
      .sort((a, b) => b.receivedMinor - a.receivedMinor || a.planName.localeCompare(b.planName)),
  }));
  currencies.sort(
    (a, b) => b.receivedMinor - a.receivedMinor || a.currency.localeCompare(b.currency),
  );

  return { from: from.toISOString(), to: to.toISOString(), groupBy, currencies };
}

const ZERO_DECIMAL = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

/** Integer minor units -> a plain number in major units (`600000, "PKR"` -> 6000), for a
 * spreadsheet cell. Mirrors shop-web's `formatMoney` scale rules. */
export function minorToMajor(minor: number, currency: string): number {
  const digits = ZERO_DECIMAL.has(currency) ? 0 : THREE_DECIMAL.has(currency) ? 3 : 2;
  return minor / 10 ** digits;
}

function localStamp(date: Date, tzOffsetMinutes: number): string {
  return shifted(date, tzOffsetMinutes).toISOString().slice(0, 16).replace("T", " ");
}

export const PAYMENT_EXPORT_COLUMNS = [
  "Date",
  "Business",
  "Plan",
  "Amount",
  "Currency",
  "Status",
  "Reference",
  "Months granted",
  "Submitted",
  "Reviewed",
  "Rejection reason",
] as const;

const STATUS_WORDS = {
  APPROVED: "Received",
  REJECTED: "Not accepted",
  PENDING: "Waiting",
} as const;

/** One row per payment in the range, oldest first -- the detail behind the report's totals. */
export function paymentExportRows(
  proofs: readonly ReportProof[],
  options: { from: Date; to: Date; tzOffsetMinutes: number },
): Array<Record<(typeof PAYMENT_EXPORT_COLUMNS)[number], string | number | null>> {
  const { from, to, tzOffsetMinutes } = options;
  return proofs
    .filter((proof) => {
      const at = effectiveDate(proof);
      return at >= from && at < to;
    })
    .sort((a, b) => effectiveDate(a).getTime() - effectiveDate(b).getTime())
    .map((proof) => ({
      Date: localStamp(effectiveDate(proof), tzOffsetMinutes).slice(0, 10),
      Business: proof.shopName,
      Plan: proof.planName,
      Amount: minorToMajor(proof.amountMinor, proof.currency),
      Currency: proof.currency,
      Status: STATUS_WORDS[proof.status],
      Reference: proof.transactionRef,
      "Months granted": proof.grantedMonths,
      Submitted: localStamp(proof.createdAt, tzOffsetMinutes),
      Reviewed: proof.reviewedAt ? localStamp(proof.reviewedAt, tzOffsetMinutes) : null,
      "Rejection reason": proof.rejectionReason,
    }));
}

/** The Excel "Summary" sheet: one row per period per currency, plus a total row per currency. */
export function summarySheetRows(
  report: PaymentReportResponse,
): Array<Array<string | number | null>> {
  const rows: Array<Array<string | number | null>> = [
    ["Period", "Currency", "Received", "Payments received", "Not accepted", "Payments rejected"],
  ];
  for (const block of report.currencies) {
    for (const period of block.periods) {
      rows.push([
        period.period,
        block.currency,
        minorToMajor(period.receivedMinor, block.currency),
        period.receivedCount,
        minorToMajor(period.rejectedMinor, block.currency),
        period.rejectedCount,
      ]);
    }
    rows.push([
      "Total",
      block.currency,
      minorToMajor(block.receivedMinor, block.currency),
      block.receivedCount,
      minorToMajor(block.rejectedMinor, block.currency),
      block.rejectedCount,
    ]);
  }
  return rows;
}
