import { createBusinessSchema } from "./create-business.schema.js";

const valid = () => ({
  name: "Corner Copies",
  address: "12 Mall Road",
  owner: { name: "Ayesha Siddiqui", email: "Ayesha@Example.com", phone: "+92 300 1234567" },
});

describe("createBusinessSchema (fix wave 1: admin-created businesses get a real owner)", () => {
  it("accepts a business with its intended owner and normalises the owner's email", () => {
    const result = createBusinessSchema.safeParse(valid());
    expect(result.success).toBe(true);
    expect(result.success && result.data.owner.email).toBe("ayesha@example.com");
  });

  it("requires the owner (a business nobody can sign in to cannot operate)", () => {
    const { owner, ...withoutOwner } = valid();
    void owner;
    expect(createBusinessSchema.safeParse(withoutOwner).success).toBe(false);
  });

  it("requires the owner's name and a valid email; phone is optional", () => {
    expect(
      createBusinessSchema.safeParse({ ...valid(), owner: { name: "", email: "a@b.co" } }).success,
    ).toBe(false);
    expect(
      createBusinessSchema.safeParse({ ...valid(), owner: { name: "A", email: "not-an-email" } })
        .success,
    ).toBe(false);
    expect(
      createBusinessSchema.safeParse({ ...valid(), owner: { name: "A", email: "a@b.co" } }).success,
    ).toBe(true);
  });

  it("never carries a password: the owner sets their own when they activate", () => {
    const result = createBusinessSchema.safeParse({
      ...valid(),
      owner: { ...valid().owner, password: "chosen-by-the-admin" },
    });
    expect(result.success).toBe(true);
    expect(result.success && "password" in result.data.owner).toBe(false);
  });
});
