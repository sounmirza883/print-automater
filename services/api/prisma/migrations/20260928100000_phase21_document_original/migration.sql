-- 21.9/21.10: JPG/PNG (and later DOCX) uploads are normalised by the worker into
-- a printable PDF stored at storage_key. The customer's original upload is kept,
-- encrypted with the same data key (encrypted_dek) but its own iv/auth_tag, at
-- original_storage_key. All three are NULL for a plain PDF upload, so existing
-- rows and the existing PDF flow are unchanged.
ALTER TABLE "documents"
  ADD COLUMN "original_storage_key" TEXT,
  ADD COLUMN "original_iv" BYTEA,
  ADD COLUMN "original_auth_tag" BYTEA;
