/** §16 */
export const Orientation = {
  PORTRAIT: "PORTRAIT",
  LANDSCAPE: "LANDSCAPE",
} as const;

export type Orientation = (typeof Orientation)[keyof typeof Orientation];
