import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ColorMode, Orientation, PaperSize, PaperType, Sides } from "@print-automated/types";
import type { PublicBranch } from "@/lib/public-branch";
import { fetchPublicInvoice, type PublicOrderResult } from "@/lib/public-order";
import { ConfigureStep, type WizardStep } from "@/components/qr/configure-step";
import { ConfirmationScreen } from "@/components/qr/confirmation";
import { GuestDetailsStep } from "@/components/qr/details-step";
import { BranchClosedScreen, OrderingBranchContext } from "@/components/qr/ordering-branch";
import { StepIndicator } from "@/components/qr/step-indicator";
import { UploadStep } from "@/components/qr/upload-step";

type ConfigureWizardStep = Extract<
  WizardStep,
  { name: "configure" | "submitting" | "submit-error" }
>;

/** The step whose `aria-current="step"` is set, as the text of its `li`. */
function currentStepText(html: string): string | null {
  const match = /<li[^>]*aria-current="step"[^>]*>((?:(?!<\/li>)[\s\S])*)<\/li>/.exec(html);
  return match ? (match[1] ?? "").replace(/<[^>]*>/g, "") : null;
}

function renderConfigure(step: ConfigureWizardStep): string {
  return renderToStaticMarkup(createElement(ConfigureStep, { step, onSubmit: () => undefined }));
}

const configureStep: ConfigureWizardStep = {
  name: "configure",
  documentId: "d1",
  filename: "Thesis.pdf",
  pageCount: 12,
};

describe("StepIndicator", () => {
  it("ticks finished steps and marks only the current one", () => {
    const html = renderToStaticMarkup(createElement(StepIndicator, { current: 3 }));
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html.match(/✓/g)).toHaveLength(2);
    expect(currentStepText(html)).toContain("Print options");
  });
});

describe("GuestDetailsStep", () => {
  const html = renderToStaticMarkup(
    createElement(GuestDetailsStep, { onContinue: () => undefined }),
  );

  it("asks for a name and a phone number, both required", () => {
    expect(html).toMatch(/<input[^>]*type="text"[^>]*required=""/);
    expect(html).toMatch(/<input[^>]*type="tel"[^>]*required=""/);
    expect(html).toContain("Your name");
    expect(html).toContain("Phone number");
  });

  it("continues with a submit button and shows the first step as current", () => {
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Continue</);
    expect(currentStepText(html)).toContain("Your details");
  });
});

describe("UploadStep", () => {
  const html = renderToStaticMarkup(
    createElement(UploadStep, { shopId: "shop-1", onReady: () => undefined }),
  );

  it("offers a file input with the accepted types, and says which they are", () => {
    expect(html).toMatch(
      /<input[^>]*type="file"[^>]*accept="application\/pdf,image\/jpeg,image\/png,\.docx"/,
    );
    expect(html).toContain("Choose a file");
    expect(html).toContain("PDF, JPEG, PNG, or Word (.docx), up to 25MB.");
  });

  it("keeps the file input reachable from the keyboard (not display:none)", () => {
    const input = /<input[^>]*type="file"[^>]*>/.exec(html)?.[0] ?? "";
    const classes = /class="([^"]*)"/.exec(input)?.[1] ?? "";
    expect(classes).not.toMatch(/\bhidden\b/);
    expect(classes).toContain("sr-only");
  });

  it("shows the second step as current", () => {
    expect(currentStepText(html)).toContain("Your file");
  });
});

describe("ConfigureStep", () => {
  it("shows the file, every option group and the page count", () => {
    const html = renderConfigure(configureStep);
    expect(html).toContain("Thesis.pdf");
    for (const legend of ["Pages", "Color", "Sides", "Orientation", "Finishing (optional)"]) {
      expect(html).toContain(`>${legend}</legend>`);
    }
    expect(html).toContain("All pages (12)");
    for (const label of ["Copies", "Paper size", "Paper type"]) {
      expect(html).toContain(label);
    }
  });

  it("checks exactly one radio in each of the four groups", () => {
    const html = renderConfigure(configureStep);
    for (const legend of ["Pages", "Color", "Sides", "Orientation"]) {
      const start = html.indexOf(`>${legend}</legend>`);
      const end = html.indexOf("</fieldset>", start);
      const group = html.slice(start, end);
      expect(group.match(/<input[^>]*type="radio"/g)).toHaveLength(2);
      expect(group.match(/<input[^>]*type="radio"[^>]*checked=""/g)).toHaveLength(1);
    }
  });

  it("places the order with an enabled submit button and shows the third step as current", () => {
    const html = renderConfigure(configureStep);
    const button = /<button[^>]*type="submit"[^>]*>[^<]*<\/button>/.exec(html)?.[0] ?? "";
    expect(button).toContain("Place order");
    expect(button).not.toContain('disabled=""');
    expect(currentStepText(html)).toContain("Print options");
  });

  it("disables the button and says so while submitting", () => {
    const html = renderConfigure({ ...configureStep, name: "submitting" });
    const button = /<button[^>]*type="submit"[^>]*>[^<]*<\/button>/.exec(html)?.[0] ?? "";
    expect(button).toContain("Placing order…");
    expect(button).toContain('disabled=""');
  });

  it("announces a failed submit as an alert", () => {
    const html = renderConfigure({ ...configureStep, name: "submit-error", message: "Nope" });
    expect(html).toMatch(/role="alert"[^>]*>[^<]*Nope/);
  });
});

describe("ConfirmationScreen", () => {
  const order: PublicOrderResult = {
    id: "o1",
    publicOrderNumber: "PA-1042",
    documentId: "d1",
    documentFilename: "Thesis.pdf",
    shopId: "shop-1",
    shopName: "Corner Copy",
    printConfiguration: {
      pages: { mode: "all" },
      copies: 2,
      paperSize: PaperSize.A4,
      paperType: PaperType.STANDARD,
      color: ColorMode.BW,
      sides: Sides.SINGLE,
      orientation: Orientation.PORTRAIT,
    },
    pricingSnapshot: {
      quote: {
        lineItems: [
          { label: "Black & white pages", amountMinor: 24000 },
          { label: "Binding", amountMinor: 5000 },
        ],
        subtotalMinor: 29000,
        platformFeeMinor: 1000,
        totalMinor: 30000,
        currency: "PKR",
      },
    },
    paymentStatus: "UNPAID",
    orderStatus: "PLACED",
    creationSource: "QR",
    customerRecordId: null,
    createdAt: "2026-10-15T09:00:00.000Z",
  };

  it("shows the order number, the shop, the total and what to do next", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmationScreen, { order, onOrderAgain: () => undefined }),
    );
    expect(html).toContain("PA-1042");
    expect(html).toContain("Corner Copy");
    expect(html).toContain("Total");
    expect(html).toContain("PKR 300.00");
    expect(html).toContain("Show this order number to the shop when you collect your prints.");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("aria-current");
  });

  it("offers the counter QR, the invoice download and a way to order again", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmationScreen, { order, onOrderAgain: () => undefined }),
    );
    expect(html).toContain("<svg");
    expect(html).toContain("QR code for order PA-1042");
    expect(html).toContain("Download invoice (PDF)");
    expect(html).toContain("Place another order");
  });

  it("says where to collect when the code named a branch, and nothing more when it did not", () => {
    const branch: PublicBranch = {
      id: "9a7d6c5b-4e3f-4a2b-8c1d-0e9f8a7b6c5d",
      name: "Gulberg",
      city: "Lahore",
      address: "12 Main Boulevard",
      isOpen: true,
    };
    const render = (value: PublicBranch | null): string =>
      renderToStaticMarkup(
        createElement(
          OrderingBranchContext.Provider,
          { value },
          createElement(ConfirmationScreen, { order, onOrderAgain: () => undefined }),
        ),
      );
    expect(render(branch)).toContain("Collect at");
    expect(render(branch)).toContain("12 Main Boulevard");
    expect(render(null)).not.toContain("Collect at");
  });
});

describe("the branch a QR code names", () => {
  const gulberg: PublicBranch = {
    id: "9a7d6c5b-4e3f-4a2b-8c1d-0e9f8a7b6c5d",
    name: "Gulberg",
    city: "Lahore",
    address: "12 Main Boulevard",
    isOpen: true,
  };
  const within = (branch: PublicBranch | null, node: ReactElement): string =>
    renderToStaticMarkup(createElement(OrderingBranchContext.Provider, { value: branch }, node));

  it("says on each step which branch the order goes to", () => {
    const steps = [
      createElement(GuestDetailsStep, { onContinue: () => undefined }),
      createElement(UploadStep, { shopId: "shop-1", onReady: () => undefined }),
      createElement(ConfigureStep, { step: configureStep, onSubmit: () => undefined }),
    ];
    for (const step of steps) {
      const html = within(gulberg, step);
      expect(html).toContain("Ordering from");
      expect(html).toContain("Gulberg");
      expect(html).toContain("Lahore");
    }
  });

  it("shows nothing extra for a code that names no branch", () => {
    const html = within(null, createElement(GuestDetailsStep, { onContinue: () => undefined }));
    expect(html).not.toContain("Ordering from");
  });

  it("tells a guest the branch is closed, and offers no way to carry on but checking again", () => {
    const html = renderToStaticMarkup(
      createElement(BranchClosedScreen, {
        branch: { ...gulberg, isOpen: false },
        onCheckAgain: () => undefined,
      }),
    );
    expect(html).toContain("Gulberg is closed right now");
    expect(html).toContain("12 Main Boulevard");
    expect(html).toContain("Check again");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('type="tel"');
  });
});

describe("fetchPublicInvoice", () => {
  const ref = { id: "o1", shopId: "shop-1", publicOrderNumber: "PA-1042" };

  it("asks the public invoice route and names the file after the order", async () => {
    const fetchImpl = jest.fn(async (_url: string) => new Response("%PDF", { status: 200 }));
    const { blob, filename } = await fetchPublicInvoice(ref, fetchImpl as unknown as typeof fetch);
    expect(String(fetchImpl.mock.calls[0]![0])).toMatch(
      /\/v1\/public\/shops\/shop-1\/orders\/o1\/invoice$/,
    );
    expect(filename).toBe("invoice-PA-1042.pdf");
    expect(blob.size).toBe(4);
  });

  it("turns a refusal into the backend's own message", async () => {
    const fetchImpl = jest.fn(
      async () => new Response(JSON.stringify({ message: "Order not found." }), { status: 404 }),
    );
    await expect(fetchPublicInvoice(ref, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "Order not found.",
    );
  });

  it("says the service is unreachable when the request gets no answer", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchPublicInvoice(ref, fetchImpl as unknown as typeof fetch)).rejects.toThrow(
      "Could not reach the print service",
    );
  });
});
