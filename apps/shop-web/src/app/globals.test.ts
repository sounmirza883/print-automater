import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

/** The custom properties declared in the block opened by `selector`. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) {
    throw new Error(`selector not found: ${selector}`);
  }
  const open = css.indexOf("{", start);
  const body = css.slice(open + 1, css.indexOf("}", open));
  const vars: Record<string, string> = {};
  const pattern = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let match = pattern.exec(body);
  while (match !== null) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      vars[name] = value.trim();
    }
    match = pattern.exec(body);
  }
  return vars;
}

/** A declared token's value; a token missing from a block fails loudly. */
function token(vars: Record<string, string>, name: string): string {
  const value = vars[name];
  if (value === undefined) {
    throw new Error(`token not declared: ${name}`);
  }
  return value;
}

const LIGHT = block(":root {");
const DARK_BY_SYSTEM = block(':root:not([data-theme="light"]) {');
const DARK_BY_SETTING = block(':root[data-theme="dark"] {');

function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  const channel = (byte: number): number => {
    const srgb = byte / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((value >> 16) & 255) +
    0.7152 * channel((value >> 8) & 255) +
    0.0722 * channel(value & 255)
  );
}

function contrast(a: string, b: string): number {
  const high = Math.max(luminance(a), luminance(b));
  const low = Math.min(luminance(a), luminance(b));
  return (high + 0.05) / (low + 0.05);
}

/** [text token, background token]: every pairing the kit puts on screen. */
const TEXT_ON: ReadonlyArray<[string, string]> = [
  ["--ink", "--surface"],
  ["--ink", "--panel"],
  ["--ink", "--panel-2"],
  ["--ink-2", "--panel"],
  ["--ink-2", "--panel-2"],
  ["--muted", "--surface"],
  ["--muted", "--panel"],
  ["--muted", "--panel-2"],
  ["--side-ink", "--side"],
  ["--inv-ink", "--inv"],
  ["--accent-fg", "--panel"],
  ["--accent-fg", "--accent-soft"],
  ["--good-fg", "--panel"],
  ["--good-fg", "--good-soft"],
  ["--warn-fg", "--panel"],
  ["--warn-fg", "--caution-soft"],
  ["--bad-fg", "--panel"],
  ["--bad-fg", "--danger-soft"],
  ["--brand-ink", "--brand"],
];

describe("globals.css themes", () => {
  it("defines the same variables in light and in both dark blocks", () => {
    const names = Object.keys(LIGHT).sort();
    expect(names.length).toBeGreaterThan(15);
    expect(Object.keys(DARK_BY_SYSTEM).sort()).toEqual(names);
    expect(Object.keys(DARK_BY_SETTING).sort()).toEqual(names);
  });

  it("keeps the two dark blocks identical, so the setting and the OS give the same dark", () => {
    expect(DARK_BY_SETTING).toEqual(DARK_BY_SYSTEM);
  });

  it("lets a Light setting win over a dark operating system", () => {
    const media = css.indexOf("@media (prefers-color-scheme: dark)");
    const systemDark = css.indexOf(':root:not([data-theme="light"]) {');
    expect(media).toBeGreaterThan(-1);
    expect(systemDark).toBeGreaterThan(media);
  });

  it("keeps the sign-in brand panel dark in both themes", () => {
    expect(luminance(token(LIGHT, "--brand"))).toBeLessThan(0.05);
    expect(luminance(token(DARK_BY_SETTING, "--brand"))).toBeLessThan(0.05);
  });

  it.each(TEXT_ON)("%s on %s reaches 4.5:1 in light", (text, background) => {
    expect(contrast(token(LIGHT, text), token(LIGHT, background))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(TEXT_ON)("%s on %s reaches 4.5:1 in dark", (text, background) => {
    expect(
      contrast(token(DARK_BY_SETTING, text), token(DARK_BY_SETTING, background)),
    ).toBeGreaterThanOrEqual(4.5);
  });
});
