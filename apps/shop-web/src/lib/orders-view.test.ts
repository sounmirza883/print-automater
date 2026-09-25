import type { ShopOrderResponse } from "@print-automated/api-client";
import {
  blockedReasonsOf,
  configurationSummary,
  isSearching,
  parseOrdersQuery,
  searchParamsFor,
  toSearchString,
} from "./orders-view";

const UUID = "3f2b8c1e-9d4a-4c7e-8a55-0b6f1d2e3a4c";
const read = (search: string) => parseOrdersQuery(new URLSearchParams(search));

describe("parseOrdersQuery", () => {
  it("reads a dashboard deep link", () => {
    expect(read("group=needsAttention")).toMatchObject({ group: "needsAttention", page: 0 });
  });

  it("drops anything the API would reject instead of forwarding it", () => {
    const query = read(
      `group=nope&printerId=not-a-uuid&from=yesterday&to=2026-09-25&priority=high&page=-4&customerId=${UUID}`,
    );
    expect(query.group).toBeNull();
    expect(query.printerId).toBe("");
    expect(query.from).toBe("");
    expect(query.to).toBe("2026-09-25");
    expect(query.priority).toBe("");
    expect(query.page).toBe(0);
    expect(query.customerId).toBe(UUID);
  });

  it("caps the page so the API's 10,000-row offset limit is never hit", () => {
    expect(read("page=999999").page).toBe(400);
  });
});

describe("searching vs grouping", () => {
  it("uses search only when text or a filter is set", () => {
    expect(isSearching(read("group=ready"))).toBe(false);
    expect(isSearching(read("page=3"))).toBe(false);
    expect(isSearching(read("q=lease"))).toBe(true);
    expect(isSearching(read("priority=0"))).toBe(true);
  });

  it("round-trips through the URL and omits empty values", () => {
    const query = read(`group=printing&q=lease&status=PRINTING&page=2`);
    expect(toSearchString(query)).toBe("?group=printing&q=lease&status=PRINTING&page=2");
    expect(toSearchString(read(""))).toBe("");
  });

  it("builds inclusive day bounds and a page offset for the search endpoint", () => {
    const params = searchParamsFor(read("from=2026-09-01&to=2026-09-05&page=2&priority=10"));
    expect(params.from).toBe("2026-09-01T00:00:00.000Z");
    expect(params.to).toBe("2026-09-05T23:59:59.999Z");
    expect(params.priority).toBe(10);
    expect(params.limit).toBe(25);
    expect(params.offset).toBe(50);
    expect(searchParamsFor(read("priority=0")).priority).toBe(0);
  });
});

describe("blockedReasonsOf", () => {
  const order = (reasons: Array<string | null>) =>
    ({
      printJobs: reasons.map((blockedReason, index) => ({
        id: `j${index}`,
        status: "WAITING",
        printerName: null,
        blockedReason,
        failureReason: null,
        failureNote: null,
        reprint: null,
      })),
    }) as Pick<ShopOrderResponse, "printJobs">;

  it("lists each distinct reason once", () => {
    expect(blockedReasonsOf(order(["NO_PAPER", null, "NO_PAPER", "AUTOMATION_DISABLED"]))).toEqual([
      "NO_PAPER",
      "AUTOMATION_DISABLED",
    ]);
    expect(blockedReasonsOf(order([]))).toEqual([]);
  });
});

describe("configurationSummary", () => {
  it("summarises and never throws on odd snapshots", () => {
    expect(
      configurationSummary({
        pages: { mode: "all" },
        copies: 2,
        paperSize: "A4",
        color: "BLACK_WHITE",
        sides: "DOUBLE",
        orientation: "PORTRAIT",
      }),
    ).toBe("A4 · Black white · Double · 2 copies");
    expect(configurationSummary(null as never)).toBe("");
  });
});
