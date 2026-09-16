/** §7.2's own Done-when: "a transport failure retries ... " -- 5
 * attempts with exponential backoff starting at 5s. More generous than
 * DOCUMENT_PROCESSING_JOB_OPTIONS's 3/2s: email transport failures
 * (rate limits, a transient SMTP/SES hiccup) are more often worth
 * waiting out than a document processing failure is. */
export const SEND_EMAIL_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5000 },
} as const;
