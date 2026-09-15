"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

export function LogoutButton(): ReactNode {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleClick(): Promise<void> {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={loggingOut}
      className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-60"
    >
      {loggingOut ? "Logging out…" : "Log out"}
    </button>
  );
}
