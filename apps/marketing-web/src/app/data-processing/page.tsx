import type { Metadata } from "next";
import { dpaDoc } from "@/content/legal";
import { LegalDocument } from "../privacy/LegalDocument";

export const metadata: Metadata = {
  title: "Data processing",
  description: dpaDoc.description,
  alternates: { canonical: "/data-processing" },
};

export default function DataProcessingPage() {
  return <LegalDocument doc={dpaDoc} />;
}
