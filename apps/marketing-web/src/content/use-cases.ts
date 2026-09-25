import {
  Briefcase,
  Building2,
  GraduationCap,
  Palette,
  Printer,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";

export type UseCase = {
  id: string;
  name: string;
  description: string;
  outcome: string;
  icon: LucideIcon;
};

export const useCases: readonly UseCase[] = [
  {
    id: "copy-shops",
    name: "Copy shops",
    description:
      "Replace the USB-stick queue at the counter. Customers upload from home and walk in to collect.",
    outcome: "Shorter queues, fewer pricing arguments",
    icon: Printer,
  },
  {
    id: "campus",
    name: "University & campus print rooms",
    description:
      "Students submit assignments and posters from their phones while operators batch work across the room.",
    outcome: "Handles the pre-deadline rush",
    icon: GraduationCap,
  },
  {
    id: "corporate",
    name: "Corporate in-house print",
    description:
      "Departments send jobs to a central print room with clear ownership and cost tracking per order.",
    outcome: "Costs visible per team",
    icon: Briefcase,
  },
  {
    id: "agencies",
    name: "Agencies & design studios",
    description:
      "Route proofs and client deliverables to the right large-format or colour printer without chasing files.",
    outcome: "Right printer, first time",
    icon: Palette,
  },
  {
    id: "documents",
    name: "Healthcare & legal document centres",
    description:
      "Sensitive files stay encrypted, access is role-limited, and the audit log shows who touched each order.",
    outcome: "Private by default, auditable",
    icon: Stethoscope,
  },
  {
    id: "chains",
    name: "Multi-branch chains",
    description:
      "One account, many shops. Compare branches, share price lists and move overflow work between locations.",
    outcome: "Every branch in one view",
    icon: Building2,
  },
];
