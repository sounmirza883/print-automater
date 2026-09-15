/** The job payload 2.7's worker will consume. Kept minimal and
 * re-fetchable-by-id rather than carrying document metadata in the job
 * itself -- the worker always reads current state from Postgres, never
 * trusts a possibly-stale snapshot captured at enqueue time. */
export interface DocumentProcessingJob {
  documentId: string;
}
