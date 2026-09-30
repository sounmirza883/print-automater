# Definition of Done — new-PRD §123 walkthrough (25.5)

Every one of the new PRD's (`docs/prd/Print Automated — Master Product Requirements Document.md`,
§123, lines 2386-2444) 28 plain-sentence criteria, walked against the shipped system with evidence
in hand — the commit(s) that built it and the test(s) that prove it — not assertion. Written at the
close of Phase 25 (`docs/architecture/2026-09-22-prd-v2-alignment.md`), which took the system from
the old PRD's consumer-marketplace spine to the new PRD's full business-operations platform.

**One item is honestly flagged as open, not checked off**: **#1, "a business can create an
account."** Everything else the new PRD asks for exists and is proven below. The old document's own
two flagged gaps — the physical-printer step and its golden-path echo — are unchanged and are
carried forward in the appendix, not repeated here, since the new PRD's §123 does not restate them
as separate line items (the closest new-PRD line, #28, is addressed on its own terms below).

---

- [ ] **A business can create an account.**
      **Open.** There is no self-service signup endpoint anywhere in the API: `shops.controller.ts`
      has no `POST` that creates a `Shop`, `auth.controller.ts`'s only registration route
      (`POST /auth/register`, Phase 1) creates an individual `User`, and `admin.controller.ts`'s
      `/admin/businesses` (16.5) is a platform-admin **read/manage** surface over shops that already
      exist, not a creation path a business itself can call. Every shop in the running system —
      seed data and every e2e fixture alike — is provisioned directly via `prisma/seed.ts` or
      `PrismaClient` in test setup, never through an HTTP call a prospective business owner could
      make. The new PRD does not explicitly defer this (checked: no "future phase" language near
      §4 tenancy or §48 multi-tenancy), so this is a genuine, unclosed gap rather than an
      intentionally-scoped-out item. Everything downstream of shop creation — staff, roles,
      printers, products, orders — is built and proven; only the first step, a business bringing
      itself into existence, has no API.

      > **Amendment (2026-09-30, fix wave 1 after the admin-panel/QR-ordering review):** the
          > product decision is **admin-only onboarding — no public self-service signup**. A
          > self-service `POST /shops/register` was briefly added (`c0d8d64`, `03064d5`) and has
          > been **removed** deliberately, along with its `registerShopSchema`. The one way a
          > business now comes into existence is `POST /admin/businesses` (platform ADMIN only),
          > which in one transaction creates the shop, its named owner's `SHOP_OWNER` account
          > (no password — the admin never knows it), their active owner membership and a
          > single-use invitation code emailed to them; the owner sets their own password with
          > that code (`POST /shop/staff-invites/activate`) and is signed in. The owner then sets
          > real prices themselves — until they do, every order is refused with
          > `SHOP_PRICING_NOT_CONFIGURED`. Proven end to end through the real API in
          > `admin.e2e-spec.ts` ("the full journey": create → activate → no-pricing 409 → owner
          > prices → a QR order is accepted). **Still open until the UI lands:** shop-web's
          > create-business form must send the owner, and shop-web needs the "Set up your
          > account" page that calls the activation endpoint — this box is ticked once a real
          > browser can walk that path.

- [x] **An owner can create users.**
      Staff invite API (16.4, `64eba07`): an owner or manager invites by email with a role,
      the invitee accepts and becomes `ShopStaff`. `shop-staff-invites.e2e-spec.ts` and
      `shop-staff-management.e2e-spec.ts` cover invite, accept, list, remove, and role change.

- [x] **Roles restrict access correctly.**
      `OPERATOR`, `PRINTER_MANAGER`, `SUPPLIER` added to `UserRole` (16.1, `348fbc2`); a
      data-driven permission catalog plus `PermissionsGuard`/`@RequirePermission()` (16.2, `57e1a7a`)
      applied to every shop route (16.3, `90f1cd7`), replacing the old uniform
      `@Roles(SHOP_COUNTER, SHOP_MANAGER, SHOP_OWNER)`. Proven exhaustively, not sampled:
      `authorization-matrix-v2.e2e-spec.ts` (25.4, `b9c35d8`) is a 41-route × {owner, manager,
      counter, operator, printerManager, a second business's owner, a customer, a platform admin,
      anonymous} cross product — every one of 43 route/role cells asserted against the actual
      permission table, not a subset. The original `authorization-matrix.e2e-spec.ts` (12.1) still
      covers the old-PRD role/resource pairs unchanged.

- [x] **A customer can be created.**
      Shop-scoped `customers` records (17.4/migration 012, `791e9f1`) for staff to create and
      search walk-in customers, alongside the pre-existing self-service `User`-backed customer path
      (Phase 1). `customers.e2e-spec.ts` covers create/search/update; `authorization-matrix-v2`
      confirms only staff with the right permission can create one, and never across businesses.

- [x] **An order can be created.**
      Both origins work: the original self-service flow (Phase 5) and counter-placed orders on a
      customer's behalf (17.5) with `creationSource = COUNTER`. `orders.e2e-spec.ts`,
      `counter-orders.e2e-spec.ts`, and `acceptance-106.e2e-spec.ts` scenario 1 (25.1, `db19d41`)
      each create a real order end-to-end against real Postgres/Redis/MinIO.

- [x] **A file can be uploaded securely.**
      Presigned PUT to a quarantine prefix, envelope-encrypted at rest (unchanged since Phase 2 —
      see the appendix's "Documents are encrypted" line, which this item rests on unmodified).
      `documents.e2e-spec.ts` and `acceptance-106.e2e-spec.ts` scenario 1 upload a real PDF through
      the real presign-then-confirm flow.

- [x] **The system can process the file.**
      Magic-bytes validation, ClamAV scan, page-count extraction (Phase 2, unchanged). Verified
      live by every acceptance-106 scenario, each of which needs a genuinely-processed document
      before pricing or allocation can run at all.

- [x] **Printing requirements can be selected.**
      `PrintConfiguration` widened (15.1) with `PaperSize` (A4/A5/A3/LETTER/LEGAL/CUSTOM), `PaperType`
      (STANDARD/PREMIUM/CARD/PHOTO) and `Finishing[]` (NONE/STAPLING/BINDING/CUTTING/LAMINATION) in
      `packages/types/src/enums/` with Zod mirrors in `packages/validation/`, absent meaning today's
      A4/simplex behaviour. `allocatePrinter`'s own candidate filter (18.4) checks every one of
      these fields against a printer's stored capabilities.

- [x] **The price can be calculated.**
      Pricing engine v2 (17.2) accounts for paper size, paper type, sides, finishing, priority, tax
      and discount as a pure function; a real write API (17.3) lets a shop set its own prices —
      closing the old document's own noted gap ("pricing has no write API"). `pricing-rules-api.e2e-spec.ts`
      and `orders-quote.e2e-spec.ts` cover it; `acceptance-106` scenario 8 (`db19d41`) proves a
      confirmed order's price snapshot survives a later price-list change unchanged, while a new
      order at the new price list gets the new price (`subtotalMinor: 15000` vs. the original
      order's unchanged `3000`).

- [x] **An order can be confirmed.**
      `accept` (idempotent) plus, ahead of it, real payment verification — either the original PSP
      checkout or manual cash/offline recording (17.6) for counter orders with no PSP.
      `shop-order-actions.e2e-spec.ts` and `manual-payments.e2e-spec.ts` cover both paths.

- [x] **A print job can be created.**
      Order-item explosion (18.3, part of `6e1a276`) turns each `OrderItem` into a `PrintJobDraft`,
      one real dispatch attempt per item (18.5). `multi-item-dispatch.e2e-spec.ts` and
      `job-order-atomic-sync.e2e-spec.ts` cover single- and multi-item orders alike.

- [x] **Printers can be configured.**
      Printer profile migration (15.3): model, location, connection type, supported sizes/paper
      types, max job pages, maintenance status. `printers.e2e-spec.ts`, `printer-detail.e2e-spec.ts`,
      `printer-rules.e2e-spec.ts` exercise registration, editing and rule configuration.

- [x] **Printer capabilities can be stored.**
      Agent heartbeat v2 (15.6, `5574f34`) reports real probed capabilities — driver name, port
      name, actual supported paper sizes — replacing the old hardcoded `a4: true, a3: false`, while
      preserving the "omit unchanged fields" merge rule so a staff override is never clobbered.
      `agent-heartbeat.e2e-spec.ts` covers both the reporting and the merge-preservation behaviour.

- [x] **Jobs can enter a queue.**
      `QUEUED` status plus deterministic ordering and NORMAL/HIGH/URGENT priority (18.8, part of
      `81d20ca`), replacing the old single `orderBy: { createdAt: "asc" }`. `print-jobs.e2e-spec.ts`
      and `job-pages-sql.e2e-spec.ts` cover queue entry and ordering.

- [x] **Jobs can be assigned manually.**
      Manual reassignment with override audit — who, when, previous printer, new printer, reason
      (18.7, part of `81d20ca`). Its legal-status set was itself found and fixed this phase:
      `packages/api-client/src/order-actions.ts` (25.2, `77e1c6e`) previously offered "move" for
      statuses (`CREATED`, `PAUSED`, `FAILED`, `TIMEOUT`) the job state machine's `SUPERSEDE` event
      has never accepted, which `concurrency-100.e2e-spec.ts`'s own request-log tally caught as
      every such reassign returning a 409. Now `REASSIGNABLE_JOB_STATUSES = {WAITING, QUEUED}`,
      matching the state machine exactly (`order-actions.test.ts` asserts every status). Live
      exercised under real concurrency by `concurrency-100.e2e-spec.ts`'s "two people act on one
      job at once" test.

- [x] **Jobs can be assigned automatically.**
      `allocatePrinter()` (18.4, part of `6e1a276`) — pure, deterministic, checking status,
      capability, page capacity, queue depth, page limit and paper availability, with a fixed
      tie-break. Wired into dispatch in place of the old unordered `findFirst` (18.5). A real
      production race was found and fixed here: dispatch read printer candidates without a lock, so
      a printer disabled in the same instant as an accept could still be chosen, stranding a
      QUEUED job on a now-disabled printer invisible to that printer's own disable sweep — found by
      `concurrency-100.e2e-spec.ts`'s "12 orders accepted while a printer is taken out of service"
      test (25.2, `841fdf2`), fixed by `allocateLocked()`'s lock-then-reread pattern
      (`484a085`, corrected in `9d74285` after the first fix's raw-SQL status re-read regressed
      `multi-item-retry.e2e-spec.ts`; see the architecture record's Phase 25 section for the full
      two-round narrative). `acceptance-106.e2e-spec.ts` scenario 2 is the direct proof this was
      impossible before Phase 18 and works now.

- [x] **Operators can receive jobs.**
      `OPERATOR` role (16.1) with its own permission set, on top of the pre-existing agent long-poll
      claim (`GET /agents/jobs?wait=25`, Phase 9, unchanged) and the shop-mobile operator production
      flow (23.8). `agent-jobs.e2e-spec.ts` and `duplicate-print-campaign.e2e-spec.ts` cover the
      claim mechanics; `authorization-matrix-v2` confirms only `OPERATOR`-permitted actions are
      available to that role.

- [x] **Page limits can be enabled.**
      Per-printer `pageLimit`/`pageLimitEnabled` (19.1) enforced inside `allocatePrinter` only when
      the toggle is on (19.2). `printer-page-limit.e2e-spec.ts`; `acceptance-106` scenario 3 is the
      direct proof — a printer at its page limit is excluded from allocation.

- [x] **Page limits can be disabled.**
      The same toggle, off: the printer is never excluded for page-limit reasons regardless of
      usage. `printer-page-limit.e2e-spec.ts`'s own disabled-state assertions; `acceptance-106`
      scenario 4 proves disabling the toggle stops it blocking allocation.

- [x] **Jobs can be reassigned.**
      Both mechanisms: manual reassignment (18.7, above) and automatic failover (19.4) — page limit
      reached, printer offline, printer error, paper unavailable or disabled triggers a handoff to
      another suitable printer, auditing the move and waking the new printer's agent while refusing
      the old one. `printer-failover.e2e-spec.ts`'s own scenarios ("disabling a printer moves both
      QUEUED jobs... old agent refused", "no other suitable printer: jobs are WAITING with a visible
      reason, none lost") plus `concurrency-100.e2e-spec.ts`'s race between a pause and a manual move
      on the same job, resolved to exactly one live job either way.

- [x] **Inventory can be tracked.**
      `inventory_items` and `inventory_movements` (20.1) with concurrency-safe stock math — row
      locks, never read-modify-write (20.2). `inventory-stock.e2e-spec.ts` (12 concurrent
      consumptions against 5 in stock), `inventory-api.e2e-spec.ts`, `inventory-consumption.e2e-spec.ts`
      (6 completions against 12 sheets) are the concurrency evidence §100 itself asks for.

- [x] **Paper availability can affect allocation.**
      A paper-availability gate inside `allocatePrinter`, honoured only when a shop has inventory
      tracking enabled (20.3, `fef8232`). `inventory-paper-gate.e2e-spec.ts`; `acceptance-106`
      scenarios 5 and 6 are the direct proof — zero stock blocks a job with `NO_PAPER`, restocking
      allocates it.

- [x] **Notifications can be generated.**
      A real notification centre (23.7) — closing the old document's own noted gap ("notifications
      have no API or feed"): staff with the right permission are notified for low stock, blocked
      jobs, late-print reports and failed prints, scoped to the right business and never to someone
      who has since left it, with `GET /v1/notifications`, unread counts, and idempotent mark-read.
      `notifications.e2e-spec.ts` is exhaustive here (a failure raising an alert can never roll back
      the job transition it rides with; a removed staff member is never notified). The pre-existing
      customer-facing progress notifications (Phase 7) and failover notifications
      (`failover-order-notification.e2e-spec.ts`) are unchanged and still covered.

- [x] **Audit logs are recorded.**
      Audit expansion (16.6, `ef1d4bc`) — payments, refunds, printer changes, staff changes and
      settings changes are now audited, closing the old document's own explicitly-named gap
      ("`RefundService` writes no audit row at all"). `audit-expansion.e2e-spec.ts` covers the
      widened set; the append-only `AuditService.record()` and redaction list (Phase 1/12) are
      unchanged underneath it.

- [x] **Business data is isolated.**
      The `ShopScopeGuard`/`ShopMembershipService` spine (Phase 1/48) is unchanged, but now proven
      over the whole new resource surface: `authorization-matrix-v2.e2e-spec.ts` (25.4, `b9c35d8`)
      asserts a second business's owner gets a clean 403 on every one of 41 routes spanning
      products, pricing, inventory, suppliers, customers, staff, settings and reports — not just the
      original order/document/printer/job set `authorization-matrix.e2e-spec.ts` (12.1) already
      covered.

- [x] **Files are protected.**
      Unchanged since Phase 2/12: envelope encryption (AES-256-GCM, KMS-wrapped DEK, plaintext DEK
      never persisted) and three independently scope-checked, audited read paths (customer/shop/agent).
      Still exercised by `documents.e2e-spec.ts`, and now additionally by every document reference
      the new authorization matrix drives (one document per role identity, so a real ownership check
      is exercised for each — see the 25.4 fix in the architecture record for why that mattered).

- [x] **The system can handle printer failure states.**
      `BlockedReason` (18.6, part of `6e1a276`: `NO_COMPATIBLE_PRINTER`, `PRINTER_OFFLINE`,
      `PRINTER_DISABLED`, `PAGE_LIMIT_REACHED`, `NO_PAPER`, `OPERATOR_UNAVAILABLE`,
      `MANUAL_APPROVAL_REQUIRED`) makes every stall a named, surfaced reason rather than a silent
      stuck job, and automatic failover (19.4) resolves the recoverable ones. `printer-failover.e2e-spec.ts`,
      `failover-containment.e2e-spec.ts`, `failover-hardening.e2e-spec.ts`, and the original
      `edge-case-suite.e2e-spec.ts` (#3 offline visibility, #4 reconnect-without-duplicating, #7
      unknown-state manual resolution) together cover the full set.

- [x] **The core workflow can be tested from order creation through completion.**
      `acceptance-106.e2e-spec.ts` (25.1, `db19d41`) drives all eight §106 scenarios through real
      HTTP against real Postgres/Redis/MinIO — including scenarios 2 through 6, which the
      architecture record's own conformance table named as **impossible** before Phase 18's
      allocation engine existed. The original `golden-path.spec.ts` (13.1) still covers the
      consumer-marketplace path end-to-end in a real browser, with the same one caveat the old
      document already flagged: the agent's physical print step is verified through
      `FakePrinterDriver`/PDFium-to-Microsoft-Print-to-PDF, not a real sheet of paper (see the
      appendix).

---

## Summary

**27 of 28 checked with evidence in hand.** The one open item, "a business can create an account,"
is a genuine gap discovered while writing this document (grepped for across every controller that
could plausibly own it) — not a previously-known one carried forward, and not something the new PRD
defers. Closing it means adding a self-service business-signup endpoint (and deciding what becomes
of it afterward — an approval step, a trial period, billing — none of which the new PRD specifies in
enough detail to build against yet).

> **Amendment (2026-09-30):** decided the other way — onboarding is admin-only, and self-service
> signup was removed on purpose. The API half is done (see item #1's own amendment); the item stays
> open only until shop-web's owner-activation page ships.

Every other line traces to a commit and a test file, and several — automatic allocation, page
limits, paper-availability gating, the notification centre, the full new authorization matrix — are
the direct proof of capabilities the architecture record's own conformance table named as **absent**
or **impossible** before this plan started. The old document's own two flagged, still-open gaps
(physical-printer validation and its golden-path echo) are unchanged; they are the new PRD's #28 as
much as the old PRD's own line, and are carried forward rather than restated as a third open item
here.

## PRD conformance matrix

Supersedes the architecture record's original "Conformance summary" table (written 2026-09-22,
before any of this work started). Same rows, current state:

| New PRD area                                                                                                                                                                                                                                                                         | 2026-09-22 (start)                               | 2026-09-28 (now)                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §48–50 multi-tenancy, security, encryption, audit spine                                                                                                                                                                                                                              | Solid                                            | **Solid, and widened** — audit now covers payments/refunds/printer/staff/settings changes (16.6); proven over the full new resource set (25.4)                                                     |
| §51–53 Redis, job queue, locking                                                                                                                                                                                                                                                     | Solid                                            | Solid, unchanged                                                                                                                                                                                   |
| §56 local print agent                                                                                                                                                                                                                                                                | Exceeds PRD (Node)                               | **Exceeds PRD, native** — C++ agent (Phase 24) shipped, Node agent deleted (24.15)                                                                                                                 |
| §20 manual allocation, §64 order/job split                                                                                                                                                                                                                                           | Partial                                          | **Done** — real order-item explosion (18.3) and manual reassignment with override audit (18.7)                                                                                                     |
| §14 pricing, §46 roles, §37 notifications, §33 customers                                                                                                                                                                                                                             | Partial                                          | **Done** — pricing has a real write API (17.3), 5 distinct shop-side roles with a real permission catalog (16.1–16.3), a real notification centre (23.7), real shop-scoped customer records (17.4) |
| §13 products, §17–19 queue/priority/allocation, §21 operators, §22–25 page limits & handoff, §26–32 inventory & suppliers, §35 manual payment, §36 invoices, §39–45 dashboards/search/filters/audit-read, §66–68 failure reasons/QC/reprint, §71 delivery, §72–77 reports & settings | Absent                                           | **Done** — Phases 17, 18, 19, 20, 21, 22, 23 built all of it; see this document's own line items above and `docs/architecture/2026-09-22-prd-v2-alignment.md` for the phase-by-phase commit trail  |
| §106 acceptance scenarios                                                                                                                                                                                                                                                            | 1, 7, 8 pass; 2–6 impossible                     | **All 8 pass** (25.1, `acceptance-106.e2e-spec.ts`)                                                                                                                                                |
| §100 concurrency                                                                                                                                                                                                                                                                     | Not tested against the new engine                | **Proven** (25.2, `concurrency-100.e2e-spec.ts`) — includes one real production race found and fixed (see "Jobs can be assigned automatically" above)                                              |
| §123 Definition of Done (this document)                                                                                                                                                                                                                                              | N/A (old PRD's own 35-item DoD was the only one) | **27/28** — see above                                                                                                                                                                              |

`UserRole.ADMIN`, dead code at the start of this plan, is now live: `/admin/businesses`,
`/admin/users`, `/admin/audit`, `/admin/system` (16.5).

---

# Appendix: original PRD Definition of Done (Phases 0-13, 13.4)

Kept in full below rather than deleted. It documents the consumer-marketplace spine the new PRD
extends rather than replaces, and several of its lines — envelope encryption, duplicate-print
protection, the physical-printer caveat — are load-bearing facts the walkthrough above cites
directly rather than re-proving. Unmodified from its original text except this heading.

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
      `SumatraPrinterDriver`/`FakePrinterDriver` abstraction (9.9), real-queue monitoring distinguishing "submitted to spooler" from "actually printed" (9.11) are built and unit-tested against `FakePrinterDriver` in CI. **9.14's own hardware validation against a real printer was never completed in this session** (commit `7dc58d5`: "(partial) ... hardware validation blocked") -- no physical printer was available. This is the one item on this list resting on code correctness and `FakePrinterDriver` coverage alone, not a real sheet of paper. Flagged here rather than checked off on assertion. **Note (Phase 24):** the printer agent has since been rewritten in native C++ (`apps/printer-agent-cpp`) with PDFium rendering straight to a Win32 printer DC, validated end-to-end against Microsoft Print to PDF (a genuine Windows driver) — the same one gap, a real sheet of paper, remains, since this machine still has no physical printer.

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

## Summary (original, Phases 0-13)

**33 of 35 checked with evidence in hand.** The remaining two (§123's physical-print item, and its one echo in the golden-path walkthrough) rest on code correctness, `FakePrinterDriver` coverage, and the print-driver abstraction's own design rather than a real sheet of paper — an honest, previously-and-repeatedly-flagged gap (9.14, 13.1, 13.3), not a newly-discovered one. Closing it requires exactly what closing 13.3's own Inno Setup verification gap requires: a real machine this session never had — a physical printer for the former, a clean Windows install target for the latter.

Every other line above traces to a specific commit, a specific test file, and in most cases a specific real-infrastructure run performed during this implementation effort — Postgres, Redis, MinIO, and ClamAV via the real dev Docker stack throughout, a real AWS Terraform plan walked as far as an account-less sandbox allows (12.7), and a real Chromium browser driving the real customer-web UI against the real backend for the golden path itself (13.1).

> **Amendment (2026-09-22, Phase 14):** this whole document is a record of Phases 0-13's own Definition of Done walkthrough, written when Terraform/AWS (ECS, RDS, ElastiCache, SES, S3, CloudWatch) genuinely was this project's production target. Phase 14 deleted that infrastructure (`infrastructure/terraform/`, 14.2) and replaced it with a self-contained Docker Compose stack (`infrastructure/docker/docker-compose.prod.yml`, 14.3-14.5) -- see `CONTEXT.md` for the current state. Every Terraform/AWS reference above describes what Phases 0-13 actually built and verified at the time; it is not a claim that Terraform/AWS is still in use today.
