/** §38 — shop-visible printer state. DISABLED is an operator choice
 * (8.4/8.9); OFFLINE/ERROR are agent-reported (9.4, 9.11). */
export const PrinterStatus = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  ERROR: "ERROR",
  DISABLED: "DISABLED",
} as const;

export type PrinterStatus = (typeof PrinterStatus)[keyof typeof PrinterStatus];
