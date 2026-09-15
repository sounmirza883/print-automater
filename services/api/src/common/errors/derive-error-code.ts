/** Turns a built-in Nest exception's class name into a stable-ish
 * SCREAMING_SNAKE_CASE code so `throw new ForbiddenException(...)`
 * still produces a reasonable error_code without every call site
 * needing to construct an AppException by hand.
 *
 * "UnauthorizedException" -> "UNAUTHORIZED"
 * "BadRequestException"   -> "BAD_REQUEST"
 */
export function deriveErrorCode(exceptionClassName: string): string {
  const withoutSuffix = exceptionClassName.replace(/Exception$/, "") || "Error";
  return withoutSuffix.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}
