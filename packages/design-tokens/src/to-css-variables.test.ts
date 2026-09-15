import { tokens } from "./tokens.js";
import { cssVariableMap, toCssVariablesText } from "./to-css-variables.js";

/** §3.2's Done-when: "A status chip rendered on web and mobile resolves
 * to the same hex values." Mobile (React Native has no CSS variables)
 * would read `tokens.colors.success` directly as a JS value; web reads
 * the generated `--color-success` custom property. This proves both
 * paths trace back to the identical hex string, not two values that
 * happen to look the same today. */
describe("CSS variable generation", () => {
  it("produces a --color-<name> variable for every semantic color, equal to the raw token", () => {
    const vars = cssVariableMap();

    expect(vars["color-primary-action"]).toBe(tokens.colors.primaryAction);
    expect(vars["color-success"]).toBe(tokens.colors.success);
    expect(vars["color-warning"]).toBe(tokens.colors.warning);
    expect(vars["color-error"]).toBe(tokens.colors.error);
    expect(vars["color-neutral"]).toBe(tokens.colors.neutral);
  });

  it("toCssVariablesText emits parseable --color-success: <hex>; matching the raw token exactly", () => {
    const css = toCssVariablesText();
    const match = /--color-success:\s*(#[0-9A-F]{6});/.exec(css);

    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(tokens.colors.success);
  });

  it("wraps every variable in a single :root block", () => {
    const css = toCssVariablesText();
    expect(css.startsWith(":root {\n")).toBe(true);
    expect(css.trimEnd().endsWith("}")).toBe(true);
    expect(css.match(/:root/g)).toHaveLength(1);
  });

  it("derives from a caller-supplied token set rather than always the default export", () => {
    const custom = { ...tokens, colors: { ...tokens.colors, success: "#00FF00" } };
    expect(cssVariableMap(custom)["color-success"]).toBe("#00FF00");
    // The real default export is untouched by that override.
    expect(tokens.colors.success).not.toBe("#00FF00");
  });
});
