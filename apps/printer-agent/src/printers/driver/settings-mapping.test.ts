import {
  ColorMode,
  Orientation,
  PaperSize,
  Sides,
  type PrintConfiguration,
} from "@print-automated/types";
import { buildPrintSettings } from "./settings-mapping.js";

function config(overrides: Partial<PrintConfiguration>): PrintConfiguration {
  return {
    pages: { mode: "all" },
    copies: 1,
    paperSize: PaperSize.A4,
    color: ColorMode.COLOR,
    sides: Sides.SINGLE,
    orientation: Orientation.PORTRAIT,
    ...overrides,
  };
}

describe("buildPrintSettings (9.9)", () => {
  it("the all-defaults baseline emits only the always-present tokens", () => {
    expect(buildPrintSettings(config({}))).toBe("paper=A4,portrait,noscale");
  });

  it("a page range is included; 'all' is omitted", () => {
    expect(buildPrintSettings(config({ pages: { mode: "range", from: 3, to: 7 } }))).toBe(
      "3-7,paper=A4,portrait,noscale",
    );
    expect(buildPrintSettings(config({ pages: { mode: "all" } }))).not.toContain("-");
  });

  it("copies > 1 is included as Nx; copies === 1 is omitted", () => {
    expect(buildPrintSettings(config({ copies: 3 }))).toBe("3x,paper=A4,portrait,noscale");
    expect(buildPrintSettings(config({ copies: 1 }))).not.toContain("x,");
  });

  it("double-sided portrait maps to duplexlong; single-sided is omitted", () => {
    expect(
      buildPrintSettings(config({ sides: Sides.DOUBLE, orientation: Orientation.PORTRAIT })),
    ).toBe("duplexlong,paper=A4,portrait,noscale");
    expect(buildPrintSettings(config({ sides: Sides.SINGLE }))).not.toContain("duplex");
  });

  it("double-sided landscape maps to duplexshort, not duplexlong", () => {
    expect(
      buildPrintSettings(config({ sides: Sides.DOUBLE, orientation: Orientation.LANDSCAPE })),
    ).toBe("duplexshort,paper=A4,landscape,noscale");
  });

  it("B&W maps to monochrome; color is omitted", () => {
    expect(buildPrintSettings(config({ color: ColorMode.BW }))).toBe(
      "monochrome,paper=A4,portrait,noscale",
    );
    expect(buildPrintSettings(config({ color: ColorMode.COLOR }))).not.toContain("monochrome");
  });

  it("paper size is always present, regardless of every other setting", () => {
    expect(buildPrintSettings(config({ paperSize: PaperSize.A4 }))).toContain("paper=A4");
  });

  it("orientation is always explicit -- portrait is emitted, not treated as an omittable default", () => {
    expect(buildPrintSettings(config({ orientation: Orientation.PORTRAIT }))).toContain("portrait");
    expect(buildPrintSettings(config({ orientation: Orientation.LANDSCAPE }))).toContain(
      "landscape",
    );
  });

  it("noscale is always present", () => {
    expect(buildPrintSettings(config({}))).toContain("noscale");
  });

  it("every non-default setting combines into one correctly-ordered token string", () => {
    const settings = buildPrintSettings(
      config({
        pages: { mode: "range", from: 3, to: 7 },
        copies: 2,
        sides: Sides.DOUBLE,
        orientation: Orientation.LANDSCAPE,
        color: ColorMode.BW,
        paperSize: PaperSize.A4,
      }),
    );
    expect(settings).toBe("3-7,2x,duplexshort,monochrome,paper=A4,landscape,noscale");
  });
});
