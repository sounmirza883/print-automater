/** Masking for audit metadata: enough to tell two rows apart when
 * investigating, never enough to recover the value. AuditService's own
 * redactMetadata only strips secrets (passwords, tokens, keys); personal
 * data has to be masked before it is handed to record() at all.
 *
 * maskEmail moved here from shop-staff-invites.service.ts (23.15) so the
 * 24.1 QR-order audit row can apply the same discipline to a guest's
 * name and phone. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

/** First character only, like maskEmail's local part. */
export function maskName(name: string): string {
  return `${name.trim().slice(0, 1)}***`;
}

/** Last two digits only; formatting characters are dropped first so a
 * spaced or dashed number cannot leak extra digits. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 2 ? `***${digits.slice(-2)}` : "***";
}
