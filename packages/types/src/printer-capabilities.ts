/** §49 — persisted as `printers.capabilities` JSONB. Used for shop
 * capability matching (§18) and printer reassignment validation (10.4). */
export interface PrinterCapabilities {
  color: boolean;
  duplex: boolean;
  a4: boolean;
  a3: boolean;
}
