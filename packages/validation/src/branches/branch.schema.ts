import { z } from "zod";
import { operatingHoursSchema } from "../shop-settings/shop-settings.schema.js";

const name = z.string().trim().min(1).max(80);
const city = z.string().trim().min(1).max(80);
const address = z.string().trim().min(1).max(200);
const phone = z.string().trim().min(1).max(40);

/** `GET /shop/branches?shopId=&includeArchived=`: the business's branches (a branch-bound person
 * only ever gets their own). Archived ones are hidden unless asked for. */
export const listBranchesQuerySchema = z.object({
  shopId: z.string().uuid(),
  includeArchived: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export type ListBranchesQueryInput = z.infer<typeof listBranchesQuerySchema>;

/** `POST /shop/branches` (owner only). The first branch of a business is created with the
 * business itself; this adds more. Opening hours are edited afterwards. */
export const createBranchSchema = z.object({
  shopId: z.string().uuid(),
  name,
  city: city.optional(),
  address,
  phone: phone.optional(),
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;

/** `PATCH /shop/branches/:id` (owner only): only what is sent changes; `null` clears an optional
 * field. Opening hours are shown, never enforced. */
export const updateBranchSchema = z
  .object({
    name: name.optional(),
    city: city.nullable().optional(),
    address: address.optional(),
    phone: phone.nullable().optional(),
    openingHours: operatingHoursSchema.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Send at least one field to change.",
  });

export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

/** `PUT /shop/branches/:id/open-state`: the branch's own open/closed switch. */
export const setBranchOpenStateSchema = z.object({ isOpen: z.boolean() });

export type SetBranchOpenStateInput = z.infer<typeof setBranchOpenStateSchema>;
