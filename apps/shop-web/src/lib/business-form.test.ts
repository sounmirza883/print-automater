import { createBusinessSchema } from "@print-automated/validation";
import {
  EMPTY_BUSINESS_FORM,
  businessFormProblems,
  toCreateBusinessInput,
  type BusinessForm,
} from "./business-form";

const filled = (over: Partial<BusinessForm> = {}): BusinessForm => ({
  ...EMPTY_BUSINESS_FORM,
  name: "  Corner Prints  ",
  address: " 1 Mall Road ",
  capabilities: { color: true, duplex: false, a4: true, a3: false },
  ownerName: " Ayesha Khan ",
  ownerEmail: " Ayesha@Example.COM ",
  ...over,
});

describe("businessFormProblems (fix wave 1)", () => {
  it("asks for the business and its owner, and nothing else", () => {
    expect(businessFormProblems(EMPTY_BUSINESS_FORM)).toEqual({
      name: "Enter a business name.",
      address: "Enter an address.",
      ownerName: "Enter the owner's name.",
      ownerEmail: "Enter the owner's email address. Their activation code goes there.",
    });
    expect(businessFormProblems(filled())).toEqual({});
  });

  it("refuses an owner email that could never receive the code", () => {
    expect(businessFormProblems(filled({ ownerEmail: "ayesha@" })).ownerEmail).toBe(
      "Enter a valid email address.",
    );
  });
});

describe("toCreateBusinessInput", () => {
  it("builds exactly the body the API's createBusinessSchema accepts", () => {
    const input = toCreateBusinessInput(filled());
    expect(input).toEqual({
      name: "Corner Prints",
      address: "1 Mall Road",
      phone: undefined,
      capabilities: { color: true, duplex: false, a4: true, a3: false },
      owner: { name: "Ayesha Khan", email: "ayesha@example.com", phone: undefined },
    });
    expect(createBusinessSchema.safeParse(input).success).toBe(true);
  });

  it("sends the optional phones only when typed", () => {
    const input = toCreateBusinessInput(filled({ phone: " 042 111 ", ownerPhone: "0300 1234567" }));
    expect(input.phone).toBe("042 111");
    expect(input.owner.phone).toBe("0300 1234567");
    expect(createBusinessSchema.safeParse(input).success).toBe(true);
  });
});
