import { registerSchema } from "./register.schema.js";
import { loginSchema } from "./login.schema.js";
import { refreshSchema } from "./refresh.schema.js";
import { recoverySchema } from "./recovery.schema.js";

describe("registerSchema", () => {
  it("accepts a valid registration payload", () => {
    const result = registerSchema.safeParse({
      name: "Ada Lovelace",
      email: "Ada@Example.com",
      password: "correcthorsebatterystaple",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("ada@example.com"); // trimmed + lowercased
    }
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = registerSchema.safeParse({
      name: "Ada",
      email: "ada@example.com",
      password: "short1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = registerSchema.safeParse({
      name: "Ada",
      email: "not-an-email",
      password: "correcthorsebatterystaple",
    });
    expect(result.success).toBe(false);
  });

  it("treats phone as optional", () => {
    const result = registerSchema.safeParse({
      name: "Ada",
      email: "ada@example.com",
      password: "correcthorsebatterystaple",
    });
    expect(result.success).toBe(true);
  });

  it("never accepts a client-supplied role (no such field exists on the schema)", () => {
    const result = registerSchema.safeParse({
      name: "Ada",
      email: "ada@example.com",
      password: "correcthorsebatterystaple",
      role: "ADMIN",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("role");
    }
  });
});

describe("loginSchema", () => {
  it("requires both email and a non-empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
  });
});

describe("refreshSchema", () => {
  it("requires a non-empty refreshToken", () => {
    expect(refreshSchema.safeParse({ refreshToken: "abc" }).success).toBe(true);
    expect(refreshSchema.safeParse({ refreshToken: "" }).success).toBe(false);
    expect(refreshSchema.safeParse({}).success).toBe(false);
  });
});

describe("recoverySchema", () => {
  it("requires a valid email", () => {
    expect(recoverySchema.safeParse({ email: "a@b.com" }).success).toBe(true);
    expect(recoverySchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});
