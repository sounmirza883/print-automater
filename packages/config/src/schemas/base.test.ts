import { z } from "zod";
import { zBooleanString } from "./base.js";

// Code review finding (Phase 14 review): z.coerce.boolean() runs
// Boolean(value) under the hood, and Boolean("false") is true in JS --
// so every .env.example in this repo writing FOO=false was silently
// coercing to `true`. zBooleanString exists specifically to make the
// literal strings "true"/"false"/"1"/"0"/"" behave the way a human
// reading an .env file would expect.
describe("zBooleanString", () => {
  const schema = z.object({ FLAG: zBooleanString(false) });

  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
    ["", false],
  ])("parses the string %j as %j", (input, expected) => {
    const result = schema.parse({ FLAG: input });
    expect(result.FLAG).toBe(expected);
  });

  it("applies the default when the var is entirely absent", () => {
    const result = z.object({ FLAG: zBooleanString(true) }).parse({});
    expect(result.FLAG).toBe(true);
  });

  it("rejects a value that isn't a recognized boolean string", () => {
    expect(() => schema.parse({ FLAG: "yes" })).toThrow();
  });

  it("passes an already-boolean value through unchanged", () => {
    const result = schema.parse({ FLAG: true });
    expect(result.FLAG).toBe(true);
  });

  it('regression: the literal string "false" must parse as false, not true', () => {
    // This is the exact bug z.coerce.boolean() had: Boolean("false") === true.
    const result = schema.parse({ FLAG: "false" });
    expect(result.FLAG).toBe(false);
  });
});
