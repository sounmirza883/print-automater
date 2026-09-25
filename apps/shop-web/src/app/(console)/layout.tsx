import type { ReactNode } from "react";
import { ConsoleFrame } from "@/components/console-frame";
import { NotificationBell } from "@/components/notification-bell";

export default function ConsoleLayout({ children }: { children: ReactNode }): ReactNode {
  return <ConsoleFrame topBarExtras={<NotificationBell />}>{children}</ConsoleFrame>;
}
