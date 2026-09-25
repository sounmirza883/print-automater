import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NotificationCentre } from "@/components/notifications/notification-centre";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage(): ReactNode {
  return <NotificationCentre />;
}
