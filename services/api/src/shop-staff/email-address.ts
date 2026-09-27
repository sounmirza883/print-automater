const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** 23.18: the address as a MAILBOX, for rate-limit keys only (the stored/compared address stays
 * the lower-cased one the person typed). Trim + lowercase, strip a `+tag`, and -- only for
 * Gmail/Googlemail, where it is true -- ignore dots and fold googlemail.com into gmail.com, so
 * one inbox cannot be given many budgets by respelling it. */
export function canonicalAddress(email: string): string {
  const lowered = email.trim().toLowerCase();
  const at = lowered.lastIndexOf("@");
  if (at < 0) return lowered;
  let local = lowered.slice(0, at);
  let domain = lowered.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replaceAll(".", "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}
