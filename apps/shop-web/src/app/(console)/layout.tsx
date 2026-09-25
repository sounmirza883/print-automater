import type { ReactNode } from "react";
import { ConsoleFrame } from "@/components/console-frame";

export default function ConsoleLayout({ children }: { children: ReactNode }): ReactNode {
  return <ConsoleFrame>{children}</ConsoleFrame>;
}
