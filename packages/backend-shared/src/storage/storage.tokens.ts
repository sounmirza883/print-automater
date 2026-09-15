/** Kept in their own file, separate from storage.module.ts, deliberately:
 * storage.module.ts imports StorageService (for its providers array) and
 * storage.service.ts imports these tokens -- if they lived in
 * storage.module.ts too, that would be a circular import, and in the
 * compiled CommonJS output (hoisted requires) the tokens would still be
 * undefined at the point @Inject(...) evaluates them (this bit 2.1 once
 * already). */
export const S3_CLIENT = Symbol("S3_CLIENT");
export const STORAGE_BUCKET = Symbol("STORAGE_BUCKET");
