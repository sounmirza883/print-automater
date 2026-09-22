# Definition of Done — §123 walkthrough (13.4)

Every one of §123's 35 checkboxes, walked against the running system with evidence in hand — the specific commit that built it, and the specific test or live check that verified it — not assertion. Compiled at the end of the 89-sub-phase implementation plan, referencing the full commit history (`git log --oneline`) and this session's own live spot-checks against the real dev stack (Postgres/Redis/MinIO/ClamAV via `docker compose`, `services/api` on `:3000`).

Two items are honestly flagged as not fully closed rather than checked off on assertion: **#21 (physical printer can print)** and, as its one downstream consequence, **#35 (golden path end-to-end)**'s own physical-print step. Both require a genuine hardware/clean-machine environment this session never had — documented at 9.14, 13.1, and 13.3 as it happened, not discovered now.

---

- [x] **Customer authentication works.**
      Argon2id password hashing + rotating-refresh JWTs (1.4), `/auth/register|login|logout|refresh` (1.5). Verified live in a real browser: `apps/customer-web/e2e/auth-round-trip.spec.ts` drives register → dashboard → logout → redirect → log back in against the real backend with real httpOnly cookies (3.3).

- [x] **Shop authentication works.**
      Same credential/token stack, shop-staff accounts distinguished by role (`SHOP_COUNTER`/`SHOP_MANAGER`/`SHOP_OWNER`). Verified throughout `services/api/test/*.e2e-spec.ts` (e.g. `shop-order-actions.e2e-spec.ts`, `printers.e2e-spec.ts`) logging in as seeded shop staff and exercising shop-scoped routes.

- [x] **PDF upload works.**
      Presigned PUT to a quarantine prefix, upload-completion confirmation (2.5), drag-and-drop with progress in the browser (4.5). Verified live in this session: `golden-path.spec.ts` (13.1) uploads a real PDF fixture through the real customer-web UI against the real backend and MinIO.

- [x] **Document validation works.**
      Magic-bytes check (not extension/MIME), 25MB size cap, ClamAV scan, page-count cap, password-protected rejection (2.7) — plus the adversarial fixture suite (renamed executable, PDF bomb, path traversal, zero-byte file, 12.2). `document-processing.service.spec.ts`: 8/8 green against real MinIO/Postgres/ClamAV.

- [x] **Page count works.**
      `pdf-lib` page-count detection, ≤500-page cap (2.7). Verified live: `golden-path.spec.ts`'s configure screen only ever renders once a real page count comes back from a genuinely-processed document.

- [x] **Print configuration works.**
      Pages (all/range), copies, paper A4, color, sides, orientation (4.6), each validated client-side and server-side. `packages/pricing`'s own exhaustive table tests cover every configuration permutation (4.1).

- [x] **Server-side pricing works.**
      `computeQuote` is pure, zero-I/O, integer minor units (4.1); `POST /orders/quote` is server-authoritative -- a client-supplied total is never trusted (4.4), re-asserted in `orders-quote.e2e-spec.ts`.

- [x] **Shop selection works.**
      `GET /shops` returns only capability-matched, currently-accepting shops (4.3); the seed's own two shops (color+duplex vs. mono+simplex) prove the filter is real, not cosmetic (`shops.e2e-spec.ts`).

- [x] **Checkout works.**
      `POST /payments/checkout` is idempotent per order (6.4); the review screen's "Pay & Place Order" flow verified live end-to-end in `golden-path.spec.ts` against the real mock-provider checkout page.

- [x] **Payment provider integration works.**
      `PaymentProvider` interface + `MockPaymentProvider` (6.2/6.3) exercising a real HMAC-signed webhook round trip, not a stub -- the same code path a real PSP adapter would use.

- [x] **Webhook verification works.**
      Raw-body HMAC signature check, `provider_event_id` unique-constraint idempotency (6.5). `webhooks.e2e-spec.ts`: an invalid signature is rejected and persists nothing; the same event delivered 5× (sequentially) and 5× (genuinely concurrently) each produce exactly one financial operation.

- [x] **Orders are created correctly.**
      Atomic `PA-YYYYMMDD-NNNNNN` numbering under concurrency (5.2, verified: 500 concurrent creations → 500 unique numbers), full state machine with an exhaustive legal/illegal transition matrix (5.4), idempotency-key-protected creation (5.3).

- [x] **Shop app receives orders.**
      `GET /shop/orders` grouped by operational state, shop-scoped at the query layer, not filtered after the fact (8.2); shop-mobile's own Orders screen consumes it (8.5-8.9).

- [x] **Staff can verify payment.**
      `GET /shop/orders/:id` surfaces `paymentStatus` directly; shop-mobile's own order-detail screen renders the unambiguous PAYMENT VERIFIED / PAYMENT PENDING banner (8.7) -- the accept action is disabled client-side and refused server-side when payment isn't confirmed (independently enforced, not just a UI convenience).

- [x] **Staff can accept/reject.**
      `accept` (idempotent, dispatches a print job), `reject` (reason required, 422 without one) -- `shop-order-actions.e2e-spec.ts`: double-tapped accept creates exactly one print job.

- [x] **Printer Agent can register.**
      One-time, hashed, 10-minute-TTL pairing codes (9.2); `POST /agents/register` binds a device's own Ed25519 public key, never a shared secret (9.3).

- [x] **Agent can authenticate.**
      Server nonce → Ed25519 signature → short-lived agent JWT, a completely separate secret/guard from human JWTs (9.3, §75). `agent-heartbeat.e2e-spec.ts`: a tampered signature is rejected; a human's own JWT is rejected on agent-only routes (401, not just insufficient-role).

- [x] **Agent can communicate with backend.**
      30s heartbeat + printer-status sync (9.4); missed-heartbeat sweep flips printers OFFLINE within the threshold (`printer-offline-sweep.e2e-spec.ts`, services/worker). Live-verified again in 13.1/13.2's own reconnect scenario: a heartbeat after an outage reconciles state without duplicating anything.

- [x] **Agent can receive print jobs.**
      `GET /agents/jobs?wait=25` long-poll on a per-device Redis list, `POST /agents/jobs/:id/claim` with an atomic `UPDATE ... WHERE status='QUEUED'` (9.7) -- two agents racing the same job: exactly one claims it (`duplicate-print-campaign.e2e-spec.ts` scenario 2).

- [x] **Agent can securely obtain documents.**
      `GET /agents/jobs/:id/document` streams the decrypted PDF, authorized by agent JWT + job assignment + job status, written to a `0600` temp file deleted in a `finally` on every path (9.8). Live-verified in `golden-path.spec.ts` (13.1): a real authenticated download decrypts to genuine `%PDF` bytes.

- [ ] **Physical printer can print.**
      `SumatraPrinterDriver`/`FakePrinterDriver` abstraction (9.9), real-queue monitoring distinguishing "submitted to spooler" from "actually printed" (9.11) are built and unit-tested against `FakePrinterDriver` in CI. **9.14's own hardware validation against a real printer was never completed in this session** (commit `7dc58d5`: "(partial) ... hardware validation blocked") -- no physical printer was available. This is the one item on this list resting on code correctness and `FakePrinterDriver` coverage alone, not a real sheet of paper. Flagged here rather than checked off on assertion.

- [x] **Agent reports result.**
      `POST /agents/jobs/:id/status` with an Idempotency-Key, retried with backoff while offline (9.12) -- `agent-job-status.e2e-spec.ts`: a report replayed under the same key produces exactly one transition, not two.

- [x] **Customer receives status.**
      Domain events mapped to notifications (7.3), the six-step plain-language progress bar with zero internal terminology ever reaching the customer (7.4, `lib/orders.ts`'s own `getOrderProgress`). Live-verified in `golden-path.spec.ts`: the real browser shows "Ready for collection" checked off at the right moment.

- [x] **Shop can mark ready.**
      `POST /shop/orders/:id/ready`, validated through the state machine (8.3) -- exercised live in `golden-path.spec.ts`.

- [x] **Shop can complete order.**
      `POST /shop/orders/:id/complete`, sets `completed_at` (8.3) -- exercised live in `golden-path.spec.ts`, and the completed order's own document deletion (13.1) chains directly off this.

- [x] **Printer failures are handled.**
      §48's full flow: offline detection → `PRINT_FAILED` → staff choice of Retry/Change Printer/Cancel/Refund (10.1), safe-vs-unsafe retry classification with no unsafe path ever auto-retrying (10.2), `PRINT_STATUS_UNKNOWN` as a first-class resolution flow, not a toast (10.3), print-timeout sweep so nothing sits QUEUED forever (10.5). Re-asserted end-to-end in 13.2's edge-case suite (#7: a real UNKNOWN report → staff resolution → correct terminal state).

- [x] **Duplicate printing is protected.**
      The job ledger is fsync'd _before_ the print command issues; a restart between the two produces `PRINT_STATUS_UNKNOWN`, never a second sheet (9.10). `duplicate-print-campaign.e2e-spec.ts`'s own six adversarial scenarios (kill-mid-print, claim race, webhook replay ×5, accept ×5, status report ×5) each produce exactly one effect -- "the strongest evidence for §123's own duplicate-protection requirement," per the plan's own words.

- [x] **Unauthorized document access is blocked.**
      Three read paths (customer/shop/agent), each scope-checked and audited (2.8); `authorization-matrix.e2e-spec.ts`'s full cross product of {role} × {own, other-shop, other-customer} × {order, document, printer, job} -- every cell asserted, not sampled (12.1). Re-asserted in 13.2 (#6: shop A → shop B document → 404).

- [x] **Documents are encrypted.**
      Envelope encryption: AES-256-GCM streaming, DEK wrapped by a KMS abstraction with both `LocalKmsProvider` and `AwsKmsProvider` passing the same contract suite, plaintext DEKs never persisted -- asserted by a test that inspects the stored row (2.2/2.3). A tampered ciphertext byte fails the auth tag, not silent corruption.

- [x] **Document retention/deletion works.**
      Configurable retention window, `DocumentDeletionService` idempotent against re-running on an already-deleted document (11.5) -- the same service both the scheduled sweep _and_ the customer-facing `DELETE /documents/:id` call, verified live end-to-end in `golden-path.spec.ts` (13.1) against a genuinely-completed order's own document, not a synthetic fixture.

- [x] **Critical events are audited.**
      Append-only `AuditService.record()` (1.7); a documented, tested redaction list (`redact-metadata.ts`) covering passwords, tokens, and this system's own domain-specific secrets (agent signatures/private keys, widened in 12.3) so none ever land in an audit row.

- [x] **Payment operations are idempotent.**
      `provider_event_id` unique constraint is the database-level backstop (6.1); `OrderLockService` (Redis, fail-fast 409) is the call-level backstop against concurrent webhook/reconciliation races (11.2's refund state machine reuses the identical pattern). Re-asserted in 13.2 (#5: duplicate webhook → processed once) and #1 (payment failure → the order can never be moved into the print pipeline, regardless of how many times accept is retried).

- [x] **Print operations are idempotent/safely reconciled.**
      Job-claim race protection (9.7), ledger-backed duplicate protection (9.10), idempotent status reporting (9.12), the full adversarial campaign (10.6), and 10.7's own offline-reconnect reconciliation. Re-asserted in 13.2 (#4: an agent reconnecting after a simulated network interruption reconciles printer state without ever duplicating a print job).

- [x] **Production errors are observable.**
      Typed `{error_code, message, retryable, request_id}` error model with per-request correlation (1.8); real structured JSON logging via `PinoLoggerService` for every service (not just HTTP request/response logs) as of 12.5, including a real bug found and fixed live (an object-first Pino call stringifying to `"[object Object]"`); five named operational metrics (order completion, print success/failure, queue depth, payment success, agent connectivity) as structured `metric`-tagged log lines; three CloudWatch Metric Filters + Alarms wired to those exact lines in Terraform (12.7) once a real AWS account exists to receive them. **Amendment (2026-09-22, Phase 14):** the Terraform/CloudWatch infrastructure this line describes was deleted in 14.2 -- production is now `infrastructure/docker/docker-compose.prod.yml`, which has no CloudWatch equivalent wired up. The structured `metric`-tagged log lines themselves are unaffected (they're application-level, not AWS-specific); only the "ship them to CloudWatch Alarms" half of this line no longer applies. Re-wiring alerting against the new Docker-only stack (e.g. a log-shipping sidecar, or a self-hosted alerting tool) is not yet done and is not in Phase 14's own scope.

- [ ] **Golden path passes end-to-end.**
      `apps/customer-web/e2e/golden-path.spec.ts` (13.1) automates all 31 steps of §121 as one continuous, passing Playwright run against the real stack -- verified twice in a row for reliability, not a one-off pass -- **except §121's own steps 21-22 (the agent sending the document to a physical printer and the printer actually printing)**, which 13.1's own Build line names as the one step "performed manually against the real printer" and which this session, lacking a physical printer, could not perform. Every other step, including the agent's own real claim/download/status-report cycle against the real backend, is genuinely automated and passing -- this is the same gap as #21 above, not a second, independent one.

---

## Summary

**33 of 35 checked with evidence in hand.** The remaining two (§123's physical-print item, and its one echo in the golden-path walkthrough) rest on code correctness, `FakePrinterDriver` coverage, and the print-driver abstraction's own design rather than a real sheet of paper — an honest, previously-and-repeatedly-flagged gap (9.14, 13.1, 13.3), not a newly-discovered one. Closing it requires exactly what closing 13.3's own Inno Setup verification gap requires: a real machine this session never had — a physical printer for the former, a clean Windows install target for the latter.

Every other line above traces to a specific commit, a specific test file, and in most cases a specific real-infrastructure run performed during this implementation effort — Postgres, Redis, MinIO, and ClamAV via the real dev Docker stack throughout, a real AWS Terraform plan walked as far as an account-less sandbox allows (12.7), and a real Chromium browser driving the real customer-web UI against the real backend for the golden path itself (13.1).

> **Amendment (2026-09-22, Phase 14):** this whole document is a record of Phases 0-13's own Definition of Done walkthrough, written when Terraform/AWS (ECS, RDS, ElastiCache, SES, S3, CloudWatch) genuinely was this project's production target. Phase 14 deleted that infrastructure (`infrastructure/terraform/`, 14.2) and replaced it with a self-contained Docker Compose stack (`infrastructure/docker/docker-compose.prod.yml`, 14.3-14.5) -- see `CONTEXT.md` for the current state. Every Terraform/AWS reference above describes what Phases 0-13 actually built and verified at the time; it is not a claim that Terraform/AWS is still in use today.
