import {
  BarChart3,
  Cog,
  Database,
  FileBarChart,
  FileText,
  HardDrive,
  KeyRound,
  Plug,
  ShieldCheck,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";

export type Capability = {
  id: string;
  name: string;
  detail: string;
  icon: LucideIcon;
};

export const capabilities: readonly Capability[] = [
  {
    id: "authentication",
    name: "Authentication",
    detail:
      "Secure sign-in with short-lived access tokens and rotating refresh tokens, so a stolen session cannot live forever.",
    icon: KeyRound,
  },
  {
    id: "database",
    name: "Database",
    detail:
      "A PostgreSQL order ledger with 14 tracked statuses and an append-only history, so nothing is silently overwritten.",
    icon: Database,
  },
  {
    id: "storage",
    name: "Storage",
    detail:
      "Customer files are kept encrypted in private storage and shared only through expiring signed links.",
    icon: HardDrive,
  },
  {
    id: "api",
    name: "API",
    detail:
      "A REST API behind the web and mobile apps, with webhooks so your own tools can react to order events.",
    icon: Terminal,
  },
  {
    id: "analytics",
    name: "Analytics",
    detail:
      "Revenue, order volume, turnaround time and printer utilisation, filtered by date, branch or printer.",
    icon: BarChart3,
  },
  {
    id: "automation",
    name: "Automation",
    detail:
      "Auto-allocation, failover and stock deduction run on their own, and every automation has an off switch.",
    icon: Cog,
  },
  {
    id: "security",
    name: "Security",
    detail:
      "Encryption in transit and at rest, virus-scanned uploads, tenant isolation, and printers never exposed to the internet.",
    icon: ShieldCheck,
  },
  {
    id: "integrations",
    name: "Integrations",
    detail:
      "Works with any printer that has a Windows driver, sends email through your SMTP, and speaks S3-compatible storage.",
    icon: Plug,
  },
  {
    id: "user-management",
    name: "User Management",
    detail:
      "8 roles with granular permissions, from owner to operator, plus invitations and instant access removal.",
    icon: Users,
  },
  {
    id: "file-management",
    name: "File Management",
    detail:
      "Accepts PDF, JPG, PNG and DOCX, and detects page count and colour usage automatically for accurate pricing.",
    icon: FileText,
  },
  {
    id: "reporting",
    name: "Reporting",
    detail:
      "Exportable sales, payment and stock reports, plus an audit log that records who did what and when.",
    icon: FileBarChart,
  },
];
