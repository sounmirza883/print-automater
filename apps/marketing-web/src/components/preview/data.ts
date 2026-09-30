/**
 * Placeholder data for the marketing dashboard mocks. Everything here is
 * illustrative. The mock is set at 09:16 on a Friday, so "today" figures are
 * morning-sized and the weekly chart has no data yet for Saturday or Sunday.
 */

export const mockTime = "09:16";
export const mockClock = `Fri ${mockTime}`;

export type JobStatus =
  | "Needs acceptance"
  | "Awaiting payment"
  | "Queued"
  | "Printing"
  | "Rerouted"
  | "Quality check"
  | "Ready for pickup"
  | "Collected"
  | "Failed";

export type JobRow = {
  order: string;
  customer: string;
  spec: string;
  pages: number;
  printer: string;
  status: JobStatus;
};

/** The five live jobs shown on the Overview screen. */
export const jobRows: JobRow[] = [
  {
    order: "PA-10482",
    customer: "Priya Nair",
    spec: "A4 B&W, duplex",
    pages: 42,
    printer: "Printer 4",
    status: "Printing",
  },
  {
    order: "PA-10481",
    customer: "Northside Law",
    spec: "A4 colour, stapled",
    pages: 120,
    printer: "Printer 4",
    status: "Rerouted",
  },
  {
    order: "PA-10480",
    customer: "Tom Okafor",
    spec: "A3 colour poster",
    pages: 3,
    printer: "Printer 1",
    status: "Queued",
  },
  {
    order: "PA-10479",
    customer: "Campus Society",
    spec: "A5 flyers, 130gsm",
    pages: 250,
    printer: "Printer 3",
    status: "Ready for pickup",
  },
  {
    order: "PA-10478",
    customer: "Lena Fischer",
    spec: "A4 B&W, single",
    pages: 18,
    printer: "Unassigned",
    status: "Awaiting payment",
  },
];

/** Today's orders for the Orders screen: the live jobs plus either end of the lifecycle. */
export const orderRows: JobRow[] = [
  {
    order: "PA-10483",
    customer: "Aisha Rahman",
    spec: "A4 colour, spiral bound",
    pages: 64,
    printer: "Unassigned",
    status: "Needs acceptance",
  },
  ...jobRows,
  {
    order: "PA-10477",
    customer: "Harbour Dental",
    spec: "A5 appointment cards",
    pages: 200,
    printer: "Printer 3",
    status: "Quality check",
  },
  {
    order: "PA-10476",
    customer: "Sam Whitlock",
    spec: "A4 B&W, stapled",
    pages: 36,
    printer: "Printer 4",
    status: "Collected",
  },
];

export type OverviewStat = {
  label: string;
  value: string;
  delta: string;
  trend: "up" | "down" | "flat";
};

export const overviewStats: OverviewStat[] = [
  { label: "Orders today", value: "31", delta: "+14% vs last Fri", trend: "up" },
  { label: "Pages printed", value: "1,240", delta: "+9% vs last Fri", trend: "up" },
  { label: "In queue", value: "7", delta: "avg wait 4 min", trend: "flat" },
  { label: "Revenue", value: "$264", delta: "+6% vs last Fri", trend: "up" },
];

export type PrinterState = "Printing" | "Idle" | "Offline" | "Low paper";

export type PrinterRow = {
  name: string;
  model: string;
  state: PrinterState;
  detail: string;
  load: number;
};

export const printerRows: PrinterRow[] = [
  {
    name: "Printer 1",
    model: "Colour laser, A3",
    state: "Printing",
    detail: "PA-10480, 3 pp",
    load: 64,
  },
  {
    name: "Printer 2",
    model: "Mono laser, A4",
    state: "Offline",
    detail: "Paused, jobs rerouted",
    load: 0,
  },
  {
    name: "Printer 3",
    model: "Colour laser, A4",
    state: "Idle",
    detail: "Ready, 0 queued",
    load: 8,
  },
  {
    name: "Printer 4",
    model: "Mono laser, A4",
    state: "Printing",
    detail: "PA-10482, 42 pp",
    load: 87,
  },
  {
    name: "Printer 5",
    model: "Wide format, A1",
    state: "Low paper",
    detail: "Roll at 12%",
    load: 31,
  },
];

export type StockRow = {
  item: string;
  detail: string;
  level: number;
  unit: string;
  remaining: string;
  threshold: number;
};

export const stockRows: StockRow[] = [
  {
    item: "A4 80gsm white",
    detail: "Trays 1 and 2",
    level: 72,
    unit: "sheets",
    remaining: "3,600",
    threshold: 20,
  },
  {
    item: "A3 100gsm white",
    detail: "Printer 1 tray",
    level: 34,
    unit: "sheets",
    remaining: "680",
    threshold: 25,
  },
  {
    item: "A4 130gsm gloss",
    detail: "Printer 3 tray",
    level: 15,
    unit: "sheets",
    remaining: "150",
    threshold: 20,
  },
  {
    item: "A1 plotter roll",
    detail: "Printer 5",
    level: 12,
    unit: "m",
    remaining: "6",
    threshold: 20,
  },
];

/** Pages printed per day this week. Friday is today (so far); the weekend has not happened yet. */
export const weeklyPages: { label: string; value: number | null }[] = [
  { label: "Mon", value: 1840 },
  { label: "Tue", value: 2210 },
  { label: "Wed", value: 1960 },
  { label: "Thu", value: 2680 },
  { label: "Fri", value: 1240 },
  { label: "Sat", value: null },
  { label: "Sun", value: null },
];

export const weeklyPagesLabel =
  "Pages printed per day this week: Monday 1,840, Tuesday 2,210, Wednesday 1,960, Thursday 2,680, and 1,240 so far today, Friday";

export const timelineSteps: {
  label: string;
  time: string;
  done: boolean;
  current?: boolean;
}[] = [
  { label: "Order placed", time: "09:12", done: true },
  { label: "Payment received", time: "09:12", done: true },
  { label: "Allocated to Printer 4", time: "09:13", done: true },
  { label: "Printing", time: "09:16", done: false, current: true },
  { label: "Ready for pickup", time: "--", done: false },
];
