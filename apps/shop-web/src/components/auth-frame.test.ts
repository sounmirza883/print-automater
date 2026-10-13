/* eslint-disable react/no-children-prop -- these tests are .ts (no JSX), and
   createElement's rest-argument form does not type-check for components whose
   `children` prop is required. Same as ui.test.ts. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthFrame } from "@/components/auth-frame";

describe("AuthFrame", () => {
  const html = renderToStaticMarkup(
    createElement(AuthFrame, {
      title: "Sign in to your business",
      intro: "For business owners, managers and staff.",
      footer: "FOOTER-LINKS",
      children: "THE-FORM",
    }),
  );

  it("gives the page one heading, the intro, the form and the footer", () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Sign in to your business");
    expect(html).toContain("For business owners, managers and staff.");
    expect(html).toContain("THE-FORM");
    expect(html).toContain("FOOTER-LINKS");
  });

  it("hides the decorative brand panel from assistive tech and paints it with the brand tokens", () => {
    expect(html).toMatch(/<section[^>]*aria-hidden="true"[^>]*bg-brand/);
  });

  it("omits the footer block when there is none", () => {
    const bare = renderToStaticMarkup(
      createElement(AuthFrame, { title: "T", intro: "I", children: "F" }),
    );
    expect(bare).not.toContain("FOOTER-LINKS");
  });
});
