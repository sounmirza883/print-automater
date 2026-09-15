/** Grows one entry per phase, as each phase's own queue comes into
 * existence -- 2.6's worker Build line names the eventual full set
 * (document-processing, notifications, print-dispatch, cleanup); only
 * document-processing exists yet, since it's the only one with both a
 * producer (2.5, here) and a reason to exist so far. Producer and
 * consumer sides must agree on the exact string, which is why this is
 * the one canonical source for it. */
export const QUEUE_NAMES = {
  DOCUMENT_PROCESSING: "document-processing",
} as const;
