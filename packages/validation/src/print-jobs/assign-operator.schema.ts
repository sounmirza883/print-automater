import { z } from "zod";

/** §21/18.9. Manual operator assignment -- `operatorId` is nullable to
 * let staff explicitly UNassign a job (send it back to the general
 * queue) with the same endpoint, rather than needing a second route
 * for "clear the assignment." */
export const assignOperatorSchema = z.object({
  operatorId: z.string().uuid().nullable(),
});

export type AssignOperatorInput = z.infer<typeof assignOperatorSchema>;
