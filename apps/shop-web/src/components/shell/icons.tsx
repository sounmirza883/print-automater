import type { ReactNode } from "react";

const NAV_ICONS: Record<string, string> = {
  dashboard: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z",
  orders: "M5 4h14v4H5V4Zm0 6h14v4H5v-4Zm0 6h14v4H5v-4Z",
  printers: "M7 9V4h10v5M7 17H5v-6h14v6h-2M7 14h10v6H7v-6Z",
  inventory: "M4 8l8-4 8 4v8l-8 4-8-4V8Zm0 0 8 4m0 0 8-4m-8 4v8",
  suppliers:
    "M3 7h11v9H3V7Zm11 3h4l3 3v3h-7v-6ZM7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  "purchase-orders": "M6 3h9l4 4v14H6V3Zm8 0v5h5M9 12h7M9 16h7",
  products: "M4 4h7l9 9-7 7-9-9V4Zm4 4h.01",
  customers:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-6 9c0-3.3 2.7-6 6-6s6 2.7 6 6M17 6a3 3 0 0 1 0 6m1 2c2 .6 3 2.4 3 5",
  staff: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 8c0-4.4 3.6-8 8-8s8 3.6 8 8",
  reports: "M5 20V10m5 10V4m5 16v-7m5 7H3",
  settings: "M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M14 4v4M8 10v4m8 2v4",
  notifications: "M6 9a6 6 0 1 1 12 0c0 5 2 6.500 2 6.500H4S6 14 6 9Zm4 10a2 2 0 0 0 4 0",
  admin: "M12 3l8 3v6c0 5-3.400 8-8 9-4.600-1-8-4-8-9V6l8-3Zm-3 9 2 2 4-4",
  // Reuse "suppliers"/"staff"'s existing shapes for visual consistency with
  // the business-scoped nav rather than drawing new one-off icons for these
  // two platform-scoped equivalents.
  "admin-businesses":
    "M3 7h11v9H3V7Zm11 3h4l3 3v3h-7v-6ZM7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  "admin-users": "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 8c0-4.4 3.6-8 8-8s8 3.6 8 8",
  // Stacked layers: plans are tiers, and no business-scoped entry has a shape
  // to reuse for them (unlike "admin-businesses"/"admin-users" above).
  "admin-plans": "M12 3 3 7.5l9 4.5 9-4.5L12 3ZM3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5",
  billing: "M3 6h18v12H3V6Zm0 4h18M7 15h4",
  // Platform payments and reports reuse the business-side shapes, as the
  // businesses/users entries above already do.
  "admin-payments": "M3 6h18v12H3V6Zm0 4h18M7 15h4",
  "admin-reports": "M5 20V10m5 10V4m5 16v-7m5 7H3",
};

export function NavIcon({
  id,
  className = "size-[18px] shrink-0",
}: {
  id: string;
  className?: string;
}): ReactNode {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={NAV_ICONS[id] ?? NAV_ICONS.dashboard} />
    </svg>
  );
}

const ICONS = {
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-13v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z",
  chevrons: "M8 10l4-4 4 4M8 14l4 4 4-4",
  check: "M5 12.500l4.500 4.500L19 7.500",
  more: "M5 7h14M5 12h14M5 17h14",
  pin: "M12 21s7-6.200 7-11a7 7 0 1 0-14 0c0 4.800 7 11 7 11Zm0-8.500a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5Z",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
} as const;

/** One of the frame's own 24px stroke icons. Decorative: every use sits beside text or inside a labelled button. */
export function Icon({
  name,
  className = "size-4 shrink-0",
}: {
  name: keyof typeof ICONS;
  className?: string;
}): ReactNode {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "dots" ? "2.6" : "1.8"}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
