import { classifyPrintFailure } from "./failure-classifier.js";

describe("classifyPrintFailure (10.2)", () => {
  it("a spawn-level failure (string error code) is safe -- the process never started", () => {
    expect(classifyPrintFailure({ code: "ENOENT" })).toBe("safe");
    expect(classifyPrintFailure({ code: "EACCES" })).toBe("safe");
  });

  it("a timeout (killed, with a signal) is unsafe -- the process was running when killed", () => {
    expect(classifyPrintFailure({ killed: true, signal: "SIGTERM", code: null })).toBe("unsafe");
  });

  it("a signal without the killed flag is still treated as unsafe", () => {
    expect(classifyPrintFailure({ signal: "SIGKILL" })).toBe("unsafe");
  });

  it("a non-zero exit code (numeric) is unsafe -- ran to completion, but exit code alone can't say when it failed", () => {
    expect(classifyPrintFailure({ code: 1 })).toBe("unsafe");
    expect(classifyPrintFailure({ code: 255 })).toBe("unsafe");
  });

  it("an unrecognized error shape defaults to unsafe", () => {
    expect(classifyPrintFailure(new Error("something else"))).toBe("unsafe");
    expect(classifyPrintFailure("a plain string")).toBe("unsafe");
    expect(classifyPrintFailure(null)).toBe("unsafe");
    expect(classifyPrintFailure(undefined)).toBe("unsafe");
    expect(classifyPrintFailure({})).toBe("unsafe");
  });

  it("§10.2's own Done-when: no unsafe path can ever classify as safe", () => {
    const unsafeShapes = [
      { killed: true, signal: "SIGTERM" },
      { signal: "SIGKILL" },
      { code: 1 },
      { code: 127 },
      new Error("random"),
      {},
      null,
      undefined,
    ];
    for (const shape of unsafeShapes) {
      expect(classifyPrintFailure(shape)).toBe("unsafe");
    }
  });
});
