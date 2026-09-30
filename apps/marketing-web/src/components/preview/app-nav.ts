import {
  BarChart3,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  Printer,
  type LucideIcon,
} from "lucide-react";

export type AppViewId = "overview" | "orders" | "printers" | "inventory" | "reports";

export type AppNavItem = {
  id: AppViewId;
  label: string;
  icon: LucideIcon;
  /** Shown in the fake address bar while this screen is open. */
  url: string;
  /** Small count or flag beside the label, as the real sidebar shows. */
  count?: string;
  flag?: "warning";
};

export const appNavItems: AppNavItem[] = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    url: "app.printautomated.example/dashboard",
  },
  {
    id: "orders",
    label: "Orders",
    icon: ClipboardList,
    url: "app.printautomated.example/orders",
    count: "7",
  },
  {
    id: "printers",
    label: "Printers",
    icon: Printer,
    url: "app.printautomated.example/printers",
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: Boxes,
    url: "app.printautomated.example/inventory",
    flag: "warning",
  },
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    url: "app.printautomated.example/reports",
  },
];
