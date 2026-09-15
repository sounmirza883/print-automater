/** Applied by whichever side actually creates the job (2.5's
 * DocumentsService.confirmUpload, the only current .add() caller) --
 * BullMQ's defaultJobOptions only affects jobs added through the Queue
 * instance they're registered on. Documented here, as a shared constant,
 * so the policy is discoverable in one place rather than a literal
 * buried in whichever module happens to call .add(). 2.7 may refine
 * this once it knows document-processing's real failure modes; 3
 * attempts with exponential backoff starting at 2s is a reasonable
 * generic default for now. */
export const DOCUMENT_PROCESSING_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
} as const;
