/** Every value here is a real, distinct §86 check -- displayed back to
 * the customer (2.5's GET /documents/:id) as documents.rejection_reason,
 * so each one gets its own value rather than one generic "invalid file"
 * (matching 4.5's "distinct UI per rejection reason (not one generic
 * 'upload failed')"). */
export const RejectionReason = {
  INVALID_FILE_TYPE: "The file is not a supported type. Upload a PDF, JPG or PNG.",
  FILE_TOO_LARGE: "The file exceeds the 25MB size limit.",
  MALWARE_DETECTED: "The file failed a security scan and cannot be accepted.",
  PAGE_LIMIT_EXCEEDED: "The document exceeds the 500-page limit.",
  PASSWORD_PROTECTED:
    "Password-protected PDFs are not supported. Please remove the password and try again.",
  CORRUPT_FILE: "The file could not be read as a valid document.",
  IMAGE_DIMENSIONS_EXCEEDED:
    "The image is too large to process. Please use an image under 40 megapixels.",
} as const;

export type RejectionReason = (typeof RejectionReason)[keyof typeof RejectionReason];
