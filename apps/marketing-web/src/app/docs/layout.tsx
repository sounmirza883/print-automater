import type { ReactNode } from "react";
import { PageShell } from "@/components/pages";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return <PageShell>{children}</PageShell>;
}
