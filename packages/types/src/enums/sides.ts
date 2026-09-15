/** §16 */
export const Sides = {
  SINGLE: "SINGLE",
  DOUBLE: "DOUBLE",
} as const;

export type Sides = (typeof Sides)[keyof typeof Sides];
