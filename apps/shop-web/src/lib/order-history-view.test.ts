import { HIDDEN_TEXT, historyDetails, historyTitle } from "./order-history-view";

describe("historyTitle", () => {
  it("reads the common events in plain words and humanises anything unknown", () => {
    expect(historyTitle("ORDER_SHOP_ACCEPT")).toBe("Order accepted");
    expect(historyTitle("JOB_REASSIGNED")).toBe("Job moved to another printer");
    expect(historyTitle("SOMETHING_NEW_LATER")).toMatch(/something new later/i);
  });
});

describe("historyDetails", () => {
  it("leaves identifiers out, formats money and enum codes, and keeps free text", () => {
    const details = historyDetails(
      {
        orderId: "8c9a3f2e",
        jobIds: ["a", "b"],
        from: "QUEUED",
        reason: "PAPER_JAM",
        note: "Tray 2 jammed",
        additionalCostMinor: 25000,
        held: true,
      },
      "PKR",
    );
    const byLabel = Object.fromEntries(details.map((d) => [d.label, d.value]));
    expect(Object.keys(byLabel)).not.toContain("Order id");
    expect(details.some((d) => d.value.includes("8c9a3f2e"))).toBe(false);
    expect(byLabel.From).toMatch(/queued/i);
    expect(byLabel.Reason).toMatch(/paper jam/i);
    expect(byLabel.Note).toBe("Tray 2 jammed");
    expect(byLabel["Extra cost"]).toMatch(/250/);
    expect(byLabel.Held).toBe("yes");
  });

  it("says a hidden value is hidden for the role rather than showing the marker", () => {
    const details = historyDetails({ note: HIDDEN_TEXT }, "PKR");
    expect(details).toEqual([{ label: "Note", value: "hidden for your role", hidden: true }]);
  });

  it("returns nothing for metadata that is not an object", () => {
    expect(historyDetails(null, "PKR")).toEqual([]);
    expect(historyDetails("x", "PKR")).toEqual([]);
    expect(historyDetails(["a"], "PKR")).toEqual([]);
  });
});
