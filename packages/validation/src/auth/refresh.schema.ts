import { z } from "zod";

/** §70 POST /auth/refresh and POST /auth/logout -- both take the raw
 * refresh token in the body (not a cookie: different client types --
 * web, mobile, agent -- have different storage strategies, decided at
 * the client layer, not dictated by this API). */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RefreshInput = z.infer<typeof refreshSchema>;
