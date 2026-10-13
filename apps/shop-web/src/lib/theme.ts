import { THEME_COOKIE } from "@/lib/cookie-names";

/** What the person chose. "system" follows the operating system. */
export type ThemeSetting = "light" | "dark" | "system";

export const THEME_SETTINGS: readonly ThemeSetting[] = ["light", "dark", "system"];

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** The saved setting. Anything that is not exactly "light" or "dark" (missing,
 * tampered, a future value) is "system", so a cookie can never inject markup. */
export function parseThemeCookie(value: string | null | undefined): ThemeSetting {
  return value === "light" || value === "dark" ? value : "system";
}

/** The value for `<html data-theme>`. Undefined means no attribute, and the
 * stylesheet then follows `prefers-color-scheme`. */
export function themeAttribute(setting: ThemeSetting): "light" | "dark" | undefined {
  return setting === "system" ? undefined : setting;
}

/** The `document.cookie` string that remembers the setting for a year. */
export function themeCookie(setting: ThemeSetting): string {
  return `${THEME_COOKIE}=${setting}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

/** The theme actually on screen. */
export function resolvedTheme(setting: ThemeSetting, osPrefersDark: boolean): "light" | "dark" {
  if (setting === "system") {
    return osPrefersDark ? "dark" : "light";
  }
  return setting;
}
