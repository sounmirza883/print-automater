/** Kept in its own file, separate from storage.module.ts, deliberately:
 * storage.module.ts imports StorageService (for its providers array) and
 * storage.service.ts imports this token -- if the token lived in
 * storage.module.ts too, that would be a circular import, and in the
 * compiled CommonJS output (hoisted requires) the token would still be
 * undefined at the point @Inject(S3_CLIENT) evaluates it. */
export const S3_CLIENT = Symbol("S3_CLIENT");
