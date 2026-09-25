import {
  Archive,
  Database,
  KeyRound,
  Lock,
  Printer,
  RefreshCcw,
  ScanLine,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

export type SecurityItem = { title: string; description: string; icon: LucideIcon };

export const securityItems: SecurityItem[] = [
  {
    title: "Encrypted in transit and at rest",
    description: "TLS on every connection and encrypted storage for files and records.",
    icon: Lock,
  },
  {
    title: "Virus-scanned uploads",
    description: "Every customer file is scanned before it can reach a printer or a staff member.",
    icon: ScanLine,
  },
  {
    title: "Role-based access",
    description: "Owners, managers and operators see and change only what their role allows.",
    icon: KeyRound,
  },
  {
    title: "Audit log",
    description: "Sensitive actions are recorded with who, what and when, and cannot be edited.",
    icon: ScrollText,
  },
  {
    title: "Tenant isolation",
    description: "Each shop's data is kept separate from every other shop.",
    icon: Database,
  },
  {
    title: "Printers never exposed",
    description: "The printer agent connects outward. No inbound ports, no public printers.",
    icon: Printer,
  },
  {
    title: "Backups",
    description: "Regular backups so a mistake or an outage does not cost you your history.",
    icon: Archive,
  },
  {
    title: "Queue recovery and failover",
    description: "Interrupted jobs are recovered and can move to another printer if you opt in.",
    icon: RefreshCcw,
  },
];

export type AuditEntry = { time: string; actor: string; action: string; target: string };

/** Fictional sample rows for the mock audit-log panel. */
export const auditEntries: AuditEntry[] = [
  {
    time: "09:42",
    actor: "S. Rahman (Manager)",
    action: "Changed price rule",
    target: "A4 colour, 100+ pages",
  },
  {
    time: "09:31",
    actor: "System",
    action: "Recovered job",
    target: "Order #1042 moved to Printer 2",
  },
  { time: "09:12", actor: "J. Ortiz (Operator)", action: "Reprinted job", target: "Order #1038" },
  {
    time: "08:57",
    actor: "A. Khan (Owner)",
    action: "Invited user",
    target: "counter@shop.example",
  },
  { time: "08:40", actor: "System", action: "Blocked upload", target: "Malware detected in file" },
];
