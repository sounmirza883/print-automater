import type { Metadata } from "next";
import { privacyDoc } from "@/content/legal";
import { LegalDocument } from "./LegalDocument";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: privacyDoc.description,
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return <LegalDocument doc={privacyDoc} />;
}
