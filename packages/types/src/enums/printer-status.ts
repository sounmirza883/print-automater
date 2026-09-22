/** §38 — shop-visible printer state. DISABLED is an operator choice
 * (8.4/8.9); OFFLINE/ERROR are agent-reported (9.4, 9.11).
 *
 * 15.3/§16 additive expansion: BUSY/PAUSED/MAINTENANCE are further
 * operator- or agent-reported states; UNKNOWN is the "never assume
 * available" state §16 requires Phase 18's allocation engine to treat
 * as unavailable rather than guess about. The original four values'
 * strings are never renamed or removed -- they're already persisted
 * data and cross the agent wire. */
export const PrinterStatus = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  ERROR: "ERROR",
  DISABLED: "DISABLED",
  BUSY: "BUSY",
  PAUSED: "PAUSED",
  MAINTENANCE: "MAINTENANCE",
  UNKNOWN: "UNKNOWN",
} as const;

export type PrinterStatus = (typeof PrinterStatus)[keyof typeof PrinterStatus];
