/** The job payload 7.2's worker-side processor consumes. Unlike
 * DocumentProcessingJob (2.6), which only carries an id and always
 * re-fetches fresh state, this carries the actual message: a password-
 * recovery email's content (a one-time token) is not something to
 * persist and re-derive later, and §78's order-notification emails
 * (7.3) build their subject/text once, at enqueue time, from whichever
 * domain event triggered them. */
export interface SendEmailJob {
  to: string;
  subject: string;
  text: string;
  /** Set only when this email corresponds to a `notifications` row
   * (7.3's order events) -- the worker stamps that row's `sentAt` once
   * delivery succeeds. Absent for one-off transactional email (e.g.
   * 1.5's password recovery), which has no such row. */
  notificationId?: string;
}
