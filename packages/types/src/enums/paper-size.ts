/** §16 — MVP shipped A4 only. 15.1/§64 expands this to the sizes a
 * real shop's counter actually handles; CUSTOM covers anything the
 * fixed list doesn't (e.g. a non-standard card stock trim) without
 * needing a new enum value every time one comes up. */
export const PaperSize = {
  A4: "A4",
  A5: "A5",
  A3: "A3",
  LETTER: "LETTER",
  LEGAL: "LEGAL",
  CUSTOM: "CUSTOM",
} as const;

export type PaperSize = (typeof PaperSize)[keyof typeof PaperSize];
