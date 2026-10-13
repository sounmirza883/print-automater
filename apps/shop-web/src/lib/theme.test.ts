import { parseThemeCookie, resolvedTheme, themeAttribute, themeCookie } from "./theme";

describe("parseThemeCookie", () => {
  it("returns a saved light or dark setting", () => {
    expect(parseThemeCookie("light")).toBe("light");
    expect(parseThemeCookie("dark")).toBe("dark");
  });

  it("treats a missing, empty, explicit-system or unknown value as system", () => {
    for (const value of [undefined, null, "", "system", "DARK", " dark", "blue"]) {
      expect(parseThemeCookie(value)).toBe("system");
    }
  });

  it("never passes a tampered value through", () => {
    expect(parseThemeCookie('"><script>alert(1)</script>')).toBe("system");
  });
});

describe("themeAttribute", () => {
  it("is the setting itself for light and dark", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });

  it("is absent for system, so CSS follows the operating system", () => {
    expect(themeAttribute("system")).toBeUndefined();
  });
});

describe("themeCookie", () => {
  it("saves the setting for a year, for the whole site", () => {
    expect(themeCookie("dark")).toBe("shop_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(themeCookie("system")).toBe("shop_theme=system; Path=/; Max-Age=31536000; SameSite=Lax");
  });
});

describe("resolvedTheme", () => {
  it("lets an explicit setting win over the operating system", () => {
    expect(resolvedTheme("light", true)).toBe("light");
    expect(resolvedTheme("dark", false)).toBe("dark");
  });

  it("follows the operating system for system", () => {
    expect(resolvedTheme("system", true)).toBe("dark");
    expect(resolvedTheme("system", false)).toBe("light");
  });
});
