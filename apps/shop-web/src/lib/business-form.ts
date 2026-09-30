import type { CreateBusinessInput } from "@print-automated/api-client";
import type { PrinterCapabilities } from "@print-automated/types";
import { isEmail, optionalText } from "@/lib/form-values";

/** Fix wave 1: what a platform admin types to onboard a business -- the only
 * way a business is created now. Besides the business itself, it names the
 * owner (the API creates their account with no password and emails them a
 * code to choose one) and what the business can print (every order is
 * checked against it, and nothing lets the business change it later). */
export interface BusinessForm {
  name: string;
  address: string;
  phone: string;
  capabilities: PrinterCapabilities;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
}

/** A4 on, since nearly every shop prints it; the admin ticks the rest. */
export const EMPTY_BUSINESS_FORM: BusinessForm = {
  name: "",
  address: "",
  phone: "",
  capabilities: { color: false, duplex: false, a4: true, a3: false },
  ownerName: "",
  ownerEmail: "",
  ownerPhone: "",
};

export const CAPABILITY_OPTIONS: ReadonlyArray<{
  key: keyof PrinterCapabilities;
  label: string;
}> = [
  { key: "a4", label: "A4 paper" },
  { key: "a3", label: "A3 paper" },
  { key: "color", label: "Colour printing" },
  { key: "duplex", label: "Double-sided printing" },
];

export type BusinessFormProblems = Partial<
  Record<"name" | "address" | "ownerName" | "ownerEmail", string>
>;

/** What must be fixed before sending: required fields and the owner's email
 * shape. Lengths are capped by the inputs themselves (the same limits the API's
 * createBusinessSchema enforces), and the API re-checks everything. */
export function businessFormProblems(form: BusinessForm): BusinessFormProblems {
  const problems: BusinessFormProblems = {};
  if (form.name.trim() === "") problems.name = "Enter a business name.";
  if (form.address.trim() === "") problems.address = "Enter an address.";
  if (form.ownerName.trim() === "") problems.ownerName = "Enter the owner's name.";
  if (form.ownerEmail.trim() === "") {
    problems.ownerEmail = "Enter the owner's email address. Their activation code goes there.";
  } else if (!isEmail(form.ownerEmail)) {
    problems.ownerEmail = "Enter a valid email address.";
  }
  return problems;
}

/** The `POST /admin/businesses` body: trimmed, blanks left out. */
export function toCreateBusinessInput(form: BusinessForm): CreateBusinessInput {
  return {
    name: form.name.trim(),
    address: form.address.trim(),
    phone: optionalText(form.phone),
    capabilities: { ...form.capabilities },
    owner: {
      name: form.ownerName.trim(),
      email: form.ownerEmail.trim().toLowerCase(),
      phone: optionalText(form.ownerPhone),
    },
  };
}
