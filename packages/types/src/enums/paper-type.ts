/** §64 — the physical stock a job prints on, orthogonal to PaperSize
 * (its dimensions). Optional on PrintConfiguration (15.1): an absent
 * value means today's implicit STANDARD-only behaviour, unchanged. */
export const PaperType = {
  STANDARD: "STANDARD",
  PREMIUM: "PREMIUM",
  CARD: "CARD",
  PHOTO: "PHOTO",
} as const;

export type PaperType = (typeof PaperType)[keyof typeof PaperType];
