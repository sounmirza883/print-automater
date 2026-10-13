"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Menu, MenuItem } from "@/components/menu";
import { Segmented } from "@/components/segmented";
import { useSession } from "@/components/session-provider";
import { Icon } from "@/components/shell/icons";
import { useTheme } from "@/components/theme-provider";
import { Avatar } from "@/components/ui";
import { roleLabel } from "@/lib/permissions";
import type { ThemeSetting } from "@/lib/theme";

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeSetting; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** Who is signed in, the Light / Dark / System setting, and Sign out. Sits at
 * the foot of the sidebar on a desktop and behind the avatar in the top bar on
 * a phone; `placement` only decides the button's look and which way it opens. */
export function AccountMenu({ placement }: { placement: "sidebar" | "topbar" }): ReactNode {
  const router = useRouter();
  const { user, businessRole } = useSession();
  const { setting, setTheme } = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  const role = roleLabel(businessRole ?? user.role);

  async function signOut(): Promise<void> {
    if (signingOut) {
      return;
    }
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <Menu
      label="Account"
      side={placement === "sidebar" ? "top" : "bottom"}
      align={placement === "sidebar" ? "start" : "end"}
      trigger={(props) =>
        placement === "sidebar" ? (
          <button
            type="button"
            {...props}
            className="flex min-h-[50px] w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left hover:bg-panel-2"
          >
            <Avatar name={user.name} tone="inv" round />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{user.name}</span>
              <span className="block truncate text-xs text-muted">{role}</span>
            </span>
            <Icon name="dots" className="size-4 shrink-0 text-muted" />
          </button>
        ) : (
          <button
            type="button"
            {...props}
            aria-label={`Account: ${user.name}`}
            className="grid size-11 shrink-0 place-items-center rounded-md"
          >
            <Avatar name={user.name} tone="inv" round />
          </button>
        )
      }
    >
      {() => (
        <>
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <p className="mt-0.5 text-xs text-muted">{role}</p>
          </div>
          <div className="border-t border-line px-2.5 py-2.5">
            <p className="mb-1.5 text-xs font-medium text-muted">Theme</p>
            <Segmented
              value={setting}
              onChange={setTheme}
              options={THEME_OPTIONS}
              ariaLabel="Theme"
              className="w-full"
            />
          </div>
          <div className="border-t border-line pt-1">
            <MenuItem onSelect={() => void signOut()}>
              {signingOut ? "Signing out…" : "Sign out"}
            </MenuItem>
          </div>
        </>
      )}
    </Menu>
  );
}
