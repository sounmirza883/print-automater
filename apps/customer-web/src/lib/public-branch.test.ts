import {
  branchStage,
  fetchPublicBranch,
  orderBranchId,
  parseBranchParam,
  type BranchLookup,
  type PublicBranch,
} from "./public-branch";

const ENV_KEY = "NEXT_PUBLIC_API_BASE_URL";
const SHOP = "3f2b8c1e-9d4a-4c7e-8a55-0b6f1d2e3a4c";
const BRANCH = "9a7d6c5b-4e3f-4a2b-8c1d-0e9f8a7b6c5d";

const original = process.env[ENV_KEY];
beforeEach(() => {
  process.env[ENV_KEY] = "https://api.example.test/";
});
afterAll(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const gulberg: PublicBranch = {
  id: BRANCH,
  name: "Gulberg",
  city: "Lahore",
  address: "12 Main Boulevard",
  isOpen: true,
};

describe("parseBranchParam", () => {
  it("accepts a branch id", () => {
    expect(parseBranchParam(BRANCH)).toBe(BRANCH);
    expect(parseBranchParam(`  ${BRANCH}  `)).toBe(BRANCH);
  });

  it("ignores a missing parameter", () => {
    expect(parseBranchParam(undefined)).toBeUndefined();
    expect(parseBranchParam("")).toBeUndefined();
  });

  it("ignores anything that is not an id, so a mangled link never breaks an order", () => {
    // The API refuses a body whose branchId is not a UUID, so it must never be sent.
    for (const value of ["gulberg", "123", "../../x", `${BRANCH}/extra`, "not a uuid", "null"]) {
      expect(parseBranchParam(value)).toBeUndefined();
    }
  });

  it("ignores a parameter given twice, which names no single branch", () => {
    expect(parseBranchParam([BRANCH, BRANCH])).toBeUndefined();
    expect(parseBranchParam([BRANCH])).toBe(BRANCH);
  });
});

describe("fetchPublicBranch", () => {
  it("reads the branch from the API's public route, on the API origin", async () => {
    const urls: string[] = [];
    const lookup = await fetchPublicBranch(SHOP, BRANCH, async (input) => {
      urls.push(String(input));
      return json(200, gulberg);
    });
    expect(urls).toEqual([`https://api.example.test/v1/public/shops/${SHOP}/branches/${BRANCH}`]);
    expect(lookup).toEqual({ kind: "found", branch: gulberg });
  });

  it("gives up on a connection that hangs, as unreachable, rather than holding the guest up", async () => {
    let signal: AbortSignal | undefined;
    const lookup = await fetchPublicBranch(SHOP, BRANCH, async (_input, init) => {
      signal = init?.signal ?? undefined;
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    expect(signal).toBeDefined();
    expect(lookup).toEqual({ kind: "unreachable" });
  });

  it("calls a branch the API does not know unknown", async () => {
    expect(
      await fetchPublicBranch(SHOP, BRANCH, async () =>
        json(404, { error_code: "BRANCH_NOT_FOUND", message: "No such branch." }),
      ),
    ).toEqual({ kind: "unknown" });
  });

  it("calls a branch the API says is gone (archived) archived, never unknown", async () => {
    expect(
      await fetchPublicBranch(SHOP, BRANCH, async () =>
        json(410, {
          error_code: "BRANCH_ARCHIVED",
          message: "This branch no longer takes orders.",
        }),
      ),
    ).toEqual({ kind: "archived" });
  });

  it("is unreachable, never an error, when the call gets no answer, is limited or fails", async () => {
    expect(
      await fetchPublicBranch(SHOP, BRANCH, async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).toEqual({ kind: "unreachable" });
    expect(await fetchPublicBranch(SHOP, BRANCH, async () => json(429, {}))).toEqual({
      kind: "unreachable",
    });
    expect(await fetchPublicBranch(SHOP, BRANCH, async () => json(500, {}))).toEqual({
      kind: "unreachable",
    });
  });

  it("is unreachable when the answer is not a branch", async () => {
    expect(
      await fetchPublicBranch(SHOP, BRANCH, async () => json(200, { hello: "world" })),
    ).toEqual({ kind: "unreachable" });
    expect(
      await fetchPublicBranch(
        SHOP,
        BRANCH,
        async () =>
          new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
      ),
    ).toEqual({ kind: "unreachable" });
  });
});

describe("orderBranchId (what the order body carries)", () => {
  const found: BranchLookup = { kind: "found", branch: gulberg };

  it("sends the branch from the link while it is known, or could not be checked", () => {
    expect(orderBranchId(BRANCH, found)).toBe(BRANCH);
    // The server checks it again at order time; a lookup that failed must not reroute the order.
    expect(orderBranchId(BRANCH, { kind: "unreachable" })).toBe(BRANCH);
  });

  it("sends nothing for a branch the API does not know, so the server falls back to the oldest", () => {
    expect(orderBranchId(BRANCH, { kind: "unknown" })).toBeUndefined();
  });

  it("sends nothing when the link has no branch", () => {
    expect(orderBranchId(undefined, { kind: "none" })).toBeUndefined();
  });
});

describe("branchStage", () => {
  it("waits for the lookup, so a closed branch is never shown the wizard first", () => {
    expect(branchStage({ kind: "loading" })).toBe("loading");
  });

  it("stops a closed branch from taking an order", () => {
    expect(branchStage({ kind: "found", branch: { ...gulberg, isOpen: false } })).toBe("closed");
  });

  it("stops an archived branch's old QR code from taking an order anywhere", () => {
    expect(branchStage({ kind: "archived" })).toBe("gone");
  });

  it("lets everything else carry on to the wizard", () => {
    expect(branchStage({ kind: "found", branch: gulberg })).toBe("ready");
    expect(branchStage({ kind: "none" })).toBe("ready");
    expect(branchStage({ kind: "unknown" })).toBe("ready");
    expect(branchStage({ kind: "unreachable" })).toBe("ready");
  });
});
