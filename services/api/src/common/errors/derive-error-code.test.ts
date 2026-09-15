import { deriveErrorCode } from "./derive-error-code.js";

describe("deriveErrorCode", () => {
  it.each([
    ["UnauthorizedException", "UNAUTHORIZED"],
    ["ForbiddenException", "FORBIDDEN"],
    ["NotFoundException", "NOT_FOUND"],
    ["ConflictException", "CONFLICT"],
    ["BadRequestException", "BAD_REQUEST"],
    ["InternalServerErrorException", "INTERNAL_SERVER_ERROR"],
  ])("%s -> %s", (input, expected) => {
    expect(deriveErrorCode(input)).toBe(expected);
  });
});
