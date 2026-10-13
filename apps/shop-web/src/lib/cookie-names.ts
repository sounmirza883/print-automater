/** Zero-dependency (safe on the Edge runtime, which `middleware.ts`
 * runs on and which has no `process.exit`).
 *
 * The names are deliberately NOT customer-web's `access_token` /
 * `refresh_token`: browsers scope cookies by host, not port, so on
 * localhost a customer signed in at :3001 and a staff member signed in
 * at :3002 would overwrite each other's session if the names matched. */
export const ACCESS_TOKEN_COOKIE = "shop_access_token";
export const REFRESH_TOKEN_COOKIE = "shop_refresh_token";
/** Display-only `{id,name,email,role}` for the shell (the API has no
 * "who am I" endpoint and the access JWT carries no name). Never used to
 * authorize anything: every request is authorized server-side by the
 * bearer token, and the effective role comes from the API's own
 * membership list. */
export const SESSION_USER_COOKIE = "shop_session_user";
/** The person's Light / Dark / System choice. Read by the root layout so the
 * first paint is already in the right theme; display-only, like the cookie above. */
export const THEME_COOKIE = "shop_theme";
