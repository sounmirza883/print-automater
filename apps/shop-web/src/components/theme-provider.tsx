"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { resolvedTheme, themeAttribute, themeCookie, type ThemeSetting } from "@/lib/theme";

interface ThemeValue {
  /** What the person chose. */
  setting: ThemeSetting;
  /** What is on screen: the setting, or the operating system's for "system". */
  resolved: "light" | "dark";
  setTheme: (next: ThemeSetting) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

const OS_DARK = "(prefers-color-scheme: dark)";

function subscribeToOs(onChange: () => void): () => void {
  const query = window.matchMedia(OS_DARK);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return value;
}

/** Holds the Light / Dark / System setting. The server has already rendered
 * `<html data-theme>` from the cookie (app/layout.tsx); a change here rewrites
 * the cookie and the attribute together, so the choice shows at once and
 * survives a reload without a flash of the other theme. */
export function ThemeProvider({
  initial,
  children,
}: {
  initial: ThemeSetting;
  children: ReactNode;
}): ReactNode {
  const [setting, setSetting] = useState<ThemeSetting>(initial);
  const osPrefersDark = useSyncExternalStore(
    subscribeToOs,
    () => window.matchMedia(OS_DARK).matches,
    () => false,
  );

  const setTheme = useCallback((next: ThemeSetting): void => {
    setSetting(next);
    document.cookie = themeCookie(next);
    const attribute = themeAttribute(next);
    if (attribute === undefined) {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = attribute;
    }
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ setting, resolved: resolvedTheme(setting, osPrefersDark), setTheme }),
    [setting, osPrefersDark, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
