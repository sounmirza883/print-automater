/* eslint-disable react/no-children-prop -- these tests are .ts (no JSX), and
   createElement's rest-argument form does not type-check for components whose
   `children` prop is required, so children go in the props object. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, ChipToggle, ChoiceGroup, Notice, SiteFrame, Stepper } from "@/components/ui";

describe("Button", () => {
  it("draws the primary action in inverse ink, never accent with white text", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { variant: "primary", children: "Continue" }),
    );
    expect(html).toContain("bg-inv");
    expect(html).toContain("text-inv-ink");
    expect(html).not.toContain("text-white");
    expect(html).toContain('type="button"');
  });

  it("submits only when asked, and can fill the width", () => {
    const html = renderToStaticMarkup(
      createElement(Button, { type: "submit", block: true, children: "Place order" }),
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain("w-full");
  });
});

describe("ChoiceGroup", () => {
  const options = [
    { value: "BW", label: "Black & white" },
    { value: "COLOR", label: "Colour" },
  ];

  it("is a real radio group with a legend, so keyboards and screen readers work as before", () => {
    const html = renderToStaticMarkup(
      createElement(ChoiceGroup, {
        legend: "Color",
        name: "color",
        value: "BW",
        options,
        onChange: () => undefined,
      }),
    );
    expect(html).toContain("<fieldset");
    expect(html).toContain(">Color</legend>");
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html.match(/name="color"/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });
});

describe("ChipToggle", () => {
  it("is a real checkbox with its label", () => {
    const html = renderToStaticMarkup(
      createElement(ChipToggle, { label: "Stapling", checked: true, onChange: () => undefined }),
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
    expect(html).toContain("Stapling");
  });
});

describe("Stepper", () => {
  it("wraps a number input between labelled minus and plus buttons", () => {
    const html = renderToStaticMarkup(
      createElement(Stepper, {
        label: "Copies",
        value: 1,
        min: 1,
        max: 500,
        onChange: () => undefined,
      }),
    );
    expect(html).toContain('type="number"');
    expect(html).toContain('aria-label="Fewer copies"');
    expect(html).toContain('aria-label="More copies"');
    // At the minimum, "fewer" cannot go lower.
    expect(html).toMatch(
      /aria-label="Fewer copies"[^>]*disabled=""|disabled=""[^>]*aria-label="Fewer copies"/,
    );
  });
});

describe("Notice", () => {
  it("passes its role through and adds none of its own", () => {
    expect(
      renderToStaticMarkup(createElement(Notice, { tone: "danger", children: "x" })),
    ).not.toContain("role=");
    expect(
      renderToStaticMarkup(createElement(Notice, { tone: "danger", role: "alert", children: "x" })),
    ).toContain('role="alert"');
  });
});

describe("SiteFrame", () => {
  it("has one main landmark and a link home from the brand", () => {
    const html = renderToStaticMarkup(createElement(SiteFrame, { children: "BODY" }));
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html).toContain('href="/"');
    expect(html).toContain("BODY");
  });
});
