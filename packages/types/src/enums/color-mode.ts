/** §16 */
export const ColorMode = {
  BW: "BW",
  COLOR: "COLOR",
} as const;

export type ColorMode = (typeof ColorMode)[keyof typeof ColorMode];
