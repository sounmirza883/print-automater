/* eslint-disable react/no-children-prop -- these tests are .ts (no JSX), and
   createElement's rest-argument form does not type-check for components whose
   `children` prop is required, so children go in the props object. Same as ui.test.ts. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FormDialog, Modal } from "@/components/modal";

/** The Close button's opening tag. */
function closeButton(html: string): string | undefined {
  return html.match(/<button[^>]*aria-label="Close dialog"[^>]*>/)?.[0];
}

describe("Modal", () => {
  it("has a Close button, so a touch screen can leave it without Escape", () => {
    const html = renderToStaticMarkup(
      createElement(Modal, { title: "Menu", onClose: () => undefined, children: "BODY" }),
    );
    const button = closeButton(html);
    expect(button).toBeDefined();
    expect(button).not.toContain('disabled=""');
  });

  it("puts Close after the content, so opening a dialog focuses its first control, not Close", () => {
    const html = renderToStaticMarkup(
      createElement(Modal, {
        title: "Edit",
        onClose: () => undefined,
        children: createElement("button", { type: "button" }, "FIRST-CONTROL"),
      }),
    );
    const first = html.indexOf("FIRST-CONTROL");
    const close = html.indexOf('aria-label="Close dialog"');
    expect(first).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(-1);
    expect(first).toBeLessThan(close);
  });

  it("disables Close while busy, so an action is never abandoned half-submitted", () => {
    const html = renderToStaticMarkup(
      createElement(Modal, {
        title: "Saving",
        onClose: () => undefined,
        busy: true,
        children: "BODY",
      }),
    );
    // The attribute, not the substring: the button's classes include `disabled:opacity-50`.
    expect(closeButton(html)).toContain('disabled=""');
  });
});

/** The submit button's opening tag. */
function submitButton(html: string): string {
  return html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? "";
}

function formDialog(props: {
  busy?: boolean;
  disabled?: boolean;
  submitTone?: "primary" | "danger";
  error?: string | null;
}): string {
  return renderToStaticMarkup(
    createElement(FormDialog, {
      title: "Remove",
      submitLabel: "Remove it",
      busy: props.busy ?? false,
      disabled: props.disabled,
      submitTone: props.submitTone,
      error: props.error ?? null,
      onSubmit: () => undefined,
      onCancel: () => undefined,
      children: "BODY",
    }),
  );
}

describe("FormDialog", () => {
  it("submits through a type=submit button, enabled when nothing is pending", () => {
    const button = submitButton(formDialog({}));
    expect(button).toContain('type="submit"');
    // The attribute, not the substring: the button's classes include `disabled:opacity-50`.
    expect(button).not.toContain('disabled=""');
  });

  it("disables the submit button while a request is in flight", () => {
    expect(submitButton(formDialog({ busy: true }))).toContain('disabled=""');
  });

  it("disables the submit button when the caller says the form is not ready", () => {
    expect(submitButton(formDialog({ disabled: true }))).toContain('disabled=""');
  });

  it("draws a danger submit button on request", () => {
    expect(submitButton(formDialog({ submitTone: "danger" }))).toContain("bg-danger");
    expect(submitButton(formDialog({}))).not.toContain("bg-danger");
  });

  it("announces the last attempt's error in an alert", () => {
    expect(formDialog({ error: "Nope" })).toMatch(/<[^>]*role="alert"[^>]*>[^<]*Nope/);
    expect(formDialog({})).not.toContain('role="alert"');
  });
});
