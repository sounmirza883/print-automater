import { tokens, type DesignTokens } from "./tokens.js";

/** Every `--custom-property: value;` this package produces, keyed by
 * its bare name (no `--` prefix, no trailing `;`) so a caller can look
 * one up directly instead of re-parsing the CSS text `toCss()` returns. */
export function cssVariableMap(source: DesignTokens = tokens): Record<string, string> {
  const vars: Record<string, string> = {};

  vars["font-family"] = source.typography.fontFamily;
  for (const [name, weight] of Object.entries(source.typography.fontWeight)) {
    vars[`font-weight-${name}`] = String(weight);
  }
  for (const [step, { fontSize, lineHeight }] of Object.entries(source.typography.scale)) {
    vars[`font-size-${step}`] = `${fontSize}px`;
    vars[`line-height-${step}`] = `${lineHeight}px`;
  }

  for (const [step, px] of Object.entries(source.spacing)) {
    vars[`spacing-${step}`] = `${px}px`;
  }

  for (const [name, px] of Object.entries(source.radius)) {
    vars[`radius-${name}`] = `${px}px`;
  }

  for (const [name, level] of Object.entries(source.elevation)) {
    vars[`elevation-${name}`] = String(level);
  }

  for (const [name, px] of Object.entries(source.borders.width)) {
    vars[`border-width-${name}`] = `${px}px`;
  }
  vars["border-color"] = source.borders.color;

  for (const [name, hex] of Object.entries(source.colors)) {
    vars[`color-${kebabCase(name)}`] = hex;
  }

  return vars;
}

/** `:root { --token: value; ... }`, ready to load as a stylesheet (or
 * inline in a `<style>` tag) -- customer-web (Tailwind v4, Phase 3.3)
 * can reference these directly in an `@theme` block. */
export function toCssVariablesText(source: DesignTokens = tokens): string {
  const lines = Object.entries(cssVariableMap(source)).map(
    ([name, value]) => `  --${name}: ${value};`,
  );
  return `:root {\n${lines.join("\n")}\n}\n`;
}

function kebabCase(camel: string): string {
  return camel.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
