export interface GeneratedDataKey {
  plaintextDek: Buffer;
  wrappedDek: Buffer;
}

/** §62: envelope encryption. Every document gets its own DEK; this
 * service only ever handles wrapping/unwrapping that DEK, never the
 * document bytes themselves (2.3's CryptoService does that, using the
 * plaintextDek this returns). Implementations: LocalKmsProvider (dev,
 * AES-256-GCM with a master key from config) and AwsKmsProvider (prod,
 * real AWS KMS) -- callers depend on this interface only, never on a
 * concrete provider (KmsModule picks one based on KMS_PROVIDER). */
export interface KeyManagementService {
  /** Generates a fresh random DEK and returns it both plaintext (for
   * immediate use encrypting a document) and wrapped (the only form
   * that's ever persisted). */
  generateDataKey(): Promise<GeneratedDataKey>;

  /** Wraps an already-generated plaintext DEK (2.7's pipeline generates
   * the DEK itself via randomBytes(32) rather than calling
   * generateDataKey(), then wraps it -- both paths exist because a real
   * KMS's native GenerateDataKey is one round trip instead of two, but
   * the pipeline needs the DEK in hand before it can start encrypting). */
  wrap(plaintextDek: Buffer): Promise<Buffer>;

  /** Recovers the plaintext DEK from its wrapped form. Throws if the
   * wrapped value has been tampered with or doesn't belong to this
   * provider's key. */
  unwrap(wrappedDek: Buffer): Promise<Buffer>;
}

export const KEY_MANAGEMENT_SERVICE = Symbol("KEY_MANAGEMENT_SERVICE");
