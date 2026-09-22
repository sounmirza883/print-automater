/** §64 — post-print finishing options a job may request, zero or more
 * at once (PrintConfiguration.finishing is an array). NONE is included
 * explicitly so a caller can represent "no finishing" without omitting
 * the field, which some UI pickers need for a default selection. */
export const Finishing = {
  NONE: "NONE",
  STAPLING: "STAPLING",
  BINDING: "BINDING",
  CUTTING: "CUTTING",
  LAMINATION: "LAMINATION",
} as const;

export type Finishing = (typeof Finishing)[keyof typeof Finishing];
