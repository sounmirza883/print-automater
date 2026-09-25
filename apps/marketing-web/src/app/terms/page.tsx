import type { Metadata } from "next";
import { termsDoc } from "@/content/legal";
import { LegalDocument } from "../privacy/LegalDocument";

export const metadata: Metadata = {
  title: "Terms of service",
  description: termsDoc.description,
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <LegalDocument doc={termsDoc} />;
}
