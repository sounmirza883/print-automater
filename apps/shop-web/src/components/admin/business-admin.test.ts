import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerPanel } from "@/components/admin/business-detail";
import { BusinessCreatedNotice } from "@/components/admin/businesses-screen";

const noop = () => undefined;

describe("BusinessCreatedNotice (fix wave 1: no password to hand over)", () => {
  it("tells the admin the owner was emailed a code, naming the address and where to use it", () => {
    const html = renderToStaticMarkup(
      createElement(BusinessCreatedNotice, {
        created: {
          id: "shop-9",
          name: "Corner Prints",
          address: "1 Mall Road",
          status: "CLOSED",
          createdAt: "2026-09-30T10:00:00.000Z",
          owner: { id: "u-9", name: "Ayesha Khan", email: "ayesha@example.com" },
        } as never,
        onDismiss: noop,
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Corner Prints");
    expect(html).toContain('href="/admin/businesses/shop-9"');
    expect(html).toContain("ayesha@example.com");
    expect(html).toContain("activation code");
    expect(html).toContain("Set up your account");
    expect(html).not.toMatch(/password is|temporary password/i);
  });
});

describe("OwnerPanel (fix wave 1)", () => {
  const owner = { id: "u-9", name: "Ayesha Khan", email: "ayesha@example.com" };
  const render = (value: Parameters<typeof OwnerPanel>[0]["owner"]) =>
    renderToStaticMarkup(
      createElement(OwnerPanel, { businessId: "shop-9", owner: value, onChanged: noop }),
    );

  it("shows a pending owner with a way to send a fresh code", () => {
    const html = render({ ...owner, activationPending: true });
    expect(html).toContain("Ayesha Khan");
    expect(html).toContain("ayesha@example.com");
    expect(html).toContain("Activation pending");
    expect(html).toContain("Send a new code");
  });

  it("offers no code to an owner who has already set their password", () => {
    const html = render({ ...owner, activationPending: false });
    expect(html).toContain("Active");
    expect(html).not.toContain("Activation pending");
    expect(html).not.toContain("Send a new code");
  });

  it("says so when a business predates named owners", () => {
    const html = render(null);
    expect(html).toContain("No owner on record");
    expect(html).not.toContain("<button");
  });
});
