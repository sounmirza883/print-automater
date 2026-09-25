# Print Automated — Aligning the System to the New Master PRD

## Context

`docs/prd/Print Automated — Master Product Requirements Document.md` (v1.0, 124 sections) is a **new, wider** product specification than the one the current system was built against.

The shipped system implements the _old_ PRD (`docs/prd/print-automated-master-prd.md`): a consumer marketplace — a customer uploads a PDF, picks a shop, pays online, the shop accepts on a mobile app, and a Windows printer agent prints it. Phases 0–13 of that plan are complete: 101 commits, tagged `milestone-pilot-ready-mvp`, 33/35 Definition-of-Done items evidenced.

The new PRD keeps that spine and adds an entire **print-shop business operations platform** on top: counter staff placing orders for walk-in customers, operators working a queue, printer managers with capability and page-limit control, a product and pricing catalog, an automatic printer allocation engine, paper inventory gating allocation, suppliers, business and automation settings, dashboards, search, reports, and a real platform-admin surface.

Alongside that, two direction changes from the user: **deployment becomes Docker-only** (no Terraform/AWS), and the Windows printer agent is **rewritten in native C++** with PDFium doing the rendering.

**The outcome:** the system satisfies the new PRD's §123 Definition of Done and all eight §106 acceptance scenarios, deploys entirely through Docker, and prints through a native C++ desktop agent — without losing anything that already works.

### Decisions locked with the user

| Decision         | Choice                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| PRD relationship | **Extend** — layer the new PRD on top; nothing working is retired                                                                       |
| Tenant naming    | Keep `Shop` in code/schema/API; render "Business" in UI copy only                                                                       |
| Ops surfaces     | New `apps/shop-web` (Next.js) for owner/admin/back-office; `shop-mobile` keeps the production floor                                     |
| Execution        | Full autonomous run, phase by phase; one commit per sub-phase; no checkpoint between phases                                             |
| Optional scope   | **All four in scope**: invoices/receipts (§36), manual payment recording (§35), JPG/PNG/DOCX (§8), purchase orders + delivery (§31/§71) |
| Infrastructure   | **Docker only.** Delete `infrastructure/terraform/`; Docker Compose for dev _and_ production                                            |
| Printer agent    | **Native C++ rewrite**, built to parity alongside the Node agent, which is deleted only once C++ prints a real job                      |
| C++ stack        | Win32 (`winspool`, `Shell_NotifyIcon`) + libcurl + libsodium + SQLite + nlohmann/json; CMake + vcpkg + MSVC                             |
| Print filter     | **PDFium linked in-process** — renders pages straight to a Win32 printer DC. Retires the unresolved GPLv3 risk of bundling SumatraPDF   |

Deferred only where the PRD itself defers: §91 MVP exclusions, §113–117 future modules (AI, subscriptions, multi-location, branch allocation).

### Two findings from the survey

**1. A live defect.** `ShopOrdersService.dispatchToPrinter()` ([shop-orders.service.ts:299-317](services/api/src/shop-orders/shop-orders.service.ts#L299-L317)) auto-picks a printer with `tx.printer.findFirst({ where: { shopId, status: { not: DISABLED } } })` — unordered, **no capability check, no availability check**. A COLOR/DOUBLE order can be dispatched to a mono/simplex printer, or to an `OFFLINE` printer with no agent attached. Capability checking exists only on the _manual_ path. Fixed in 15.2, before the engine arrives in Phase 18.

**2. The installer has never been built.** Commit `8b8bbc2 "13.3 add agent installer"` shipped the recipe — `installer/setup.iss` plus `scripts/package-installer.ps1` — but on this machine `ISCC.exe` is not on PATH, there is no Inno Setup installation, and neither `dist-pkg/` nor `installer/output/` exists. The script's own fallback branch ("ISCC.exe not found on PATH — skipping installer compilation") is what runs here. No installer executable has ever been produced or tested. Phase 24 actually builds one.

---

## Conformance summary

| New PRD area                                                                                                                                                                                                                                                                         | Today                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §48–50 multi-tenancy, security, encryption, audit spine                                                                                                                                                                                                                              | **Solid** — guards + `ShopScopeGuard` + envelope encryption + append-only audit                                                                        |
| §51–53 Redis, job queue, locking                                                                                                                                                                                                                                                     | **Solid** — BullMQ, 8 queues, Redis order locks                                                                                                        |
| §56 local print agent                                                                                                                                                                                                                                                                | **Exceeds PRD** — Ed25519 identity, long-poll claim, fsync'd duplicate-print ledger (being ported to C++)                                              |
| §20 manual allocation, §64 order/job split                                                                                                                                                                                                                                           | **Partial** — jobs are retry history, not real work splitting; reassign only from `PRINT_FAILED`                                                       |
| §14 pricing, §46 roles, §37 notifications, §33 customers                                                                                                                                                                                                                             | **Partial** — pricing has no write API; the 3 shop roles are functionally identical; notifications have no API or feed; customers are just `User` rows |
| §13 products, §17–19 queue/priority/allocation, §21 operators, §22–25 page limits & handoff, §26–32 inventory & suppliers, §35 manual payment, §36 invoices, §39–45 dashboards/search/filters/audit-read, §66–68 failure reasons/QC/reprint, §71 delivery, §72–77 reports & settings | **Absent** — no model, no endpoint, no UI                                                                                                              |
| §106 acceptance scenarios                                                                                                                                                                                                                                                            | 1, 7, 8 pass today. **2, 3, 4, 5, 6 are impossible** — they all need the allocation engine                                                             |

`UserRole.ADMIN` exists in the schema and is seeded, but has **zero** guard usages, routes or UI — dead code today.

---

## Phases

Continuing the existing numbering (the old plan ended at 13). Commit convention stays `N.M <imperative summary>`; one commit per sub-phase, only after its Done-when is verified.

### Phase 14 — Context, and Docker-only infrastructure

- **14.1 Write the context files.** `CONTEXT.md` at the repo root — a living orientation document: what the product is, which PRD is authoritative, what is built, what this plan changes, the locked decisions above, and where to look first. Plus `docs/architecture/2026-09-22-prd-v2-alignment.md` — this plan, committed into the repo beside the existing `2026-09-15-design.md`, so the architecture record is complete rather than living only in a plan file. **Done first** so any session picking this up mid-flight knows the context immediately.
- **14.2 Delete Terraform.** Remove `infrastructure/terraform/` entirely — 20 `.tf` files plus the committed `.terraform/` provider binaries.
- **14.3 Production Docker Compose.** New `infrastructure/docker/docker-compose.prod.yml` covering api, worker, customer-web, shop-web, postgres, redis, minio, clamav and SMTP, with named volumes, healthchecks, restart policies and resource limits — replacing what RDS, ElastiCache, S3, SES and ECS provided. `KMS_PROVIDER=local` (the local provider already exists), MinIO for object storage.
- **14.4 Rewrite the deploy pipeline.** `.github/workflows/deploy-staging.yml` currently runs Terraform; rewrite to build images, push to a registry, deploy over SSH with Compose, gate on `/health/ready`, and update `infrastructure/scripts/rollback.sh` and `smoke-test.mjs` to match.
- **14.5 Production SMTP transport + config correction.** `ses-email-transport.ts` is AWS-specific; add a generic SMTP transport alongside the existing MailHog one and select it by env. Update `packages/config` schemas, `.env.example` files, and correct every Terraform/AWS reference in `docs/architecture/2026-09-15-design.md` and `docs/definition-of-done.md`.

### Phase 15 — Domain expansion

- **15.1 Print options expansion.** `PaperSize` → A4/A5/A3/LETTER/LEGAL/CUSTOM, new `PaperType` (STANDARD/PREMIUM/CARD/PHOTO), new `Finishing` (NONE/STAPLING/BINDING/CUTTING/LAMINATION) in [packages/types/src/enums/](packages/types/src/enums/) with Zod mirrors in [packages/validation/](packages/validation/). `PrintConfiguration` gains optional `paperType`/`finishing[]`; absent means today's behaviour. _Done-when:_ existing A4 orders round-trip byte-identical.
- **15.2 Hotfix: gate auto-dispatch on capability and availability.** Reuse the existing `printerSupportsConfiguration()`, require `status = ONLINE` and an attached agent, order deterministically. `capabilities === null` must **exclude** on the auto path while still meaning "trust the human" on the manual path. _Done-when:_ a COLOR order with only a mono printer returns `NO_PRINTER_AVAILABLE` instead of silently mis-printing.
- **15.3 Migration 010 — printer profile.** `model`, `location`, `connectionType`, `supportedSizes[]`, `supportedPaperTypes[]`, `maxJobPages`, `maintenanceStatus`, `lastStatusAt`; `PrinterStatus` → the 8 §16 values (`BUSY`, `PAUSED`, `MAINTENANCE`, `UNKNOWN` added). §16's rule — never assume available when `UNKNOWN` — encoded in the allocation candidate filter.
- **15.4 Migration 011 — order items and job columns.** `order_items` (`orderId`, `documentId`, `printConfiguration`, `quantity`, `itemType`, `required`, `pricingSnapshot`, `sequence`); `print_jobs` gains `orderItemId?`, `blockedReason?`, `supersededAt?`, `pausedAt?`, `attempt`, `priority`; `orders.qualityCheckStatus`, `shops.qualityCheckEnabled`, `shops.multiItemEnabled` (default false). Backfill one synthetic OrderItem per existing order; set `supersededAt` on non-newest jobs to reproduce today's `take: 1` as data. Tighten `orderItemId` NOT NULL in a follow-up migration.
- **15.5 Migration 012 — customer records.** Shop-scoped `customers` (name, phone, email, company, address, status) per §33; `orders.customerRecordId?` alongside the existing `customerId`, so self-service users and walk-ins coexist.
- **15.6 Agent heartbeat v2.** Report `driverName`/`portName` (already discovered in [discovery.ts:64-71](apps/printer-agent/src/printers/discovery.ts#L64-L71) and currently dropped), real supported paper sizes, page counters and consumable state. Preserve the "omit capabilities when unchanged" merge rule so staff overrides are not clobbered. **This freezes the agent wire contract** — nothing in Phases 16–23 changes it, which is what lets Phase 24 be pulled forward if wanted.

### Phase 16 — Roles, permissions and admin

- **16.1** Add `OPERATOR`, `PRINTER_MANAGER`, `SUPPLIER` to `UserRole`. Make `ShopStaff.role` authoritative for shop-scoped decisions — **it is stored but never read today**, so owner/manager/counter have identical access.
- **16.2** Permission catalog (§47) + `PermissionsGuard` + `@RequirePermission()`, slotting into the existing `JwtAuthGuard → RolesGuard → ShopScopeGuard` chain. The role→permission map is data, not code branches.
- **16.3** Apply permissions to every existing shop route, replacing the uniform `@Roles(SHOP_COUNTER, SHOP_MANAGER, SHOP_OWNER)`.
- **16.4** Staff management API — invite, add, remove, change role. Only `GET /shop/staff/me` exists today.
- **16.5** Platform admin API (§4.7, §42): `/admin/businesses`, `/admin/users`, `/admin/audit`, `/admin/system`. Activates the dead `ADMIN` role.
- **16.6** Audit expansion (§45) plus a read API. Payments, refunds, printer changes, staff changes and settings changes are **not** audited today; `RefundService` writes no audit row at all.

### Phase 17 — Products, pricing and counter ordering

- **17.1 Migration 013 — products and prices** (§13): per-shop named products with category, unit, tax config, printer/paper requirements, availability.
- **17.2 Pricing engine v2** (§14) in [packages/pricing/](packages/pricing/): paper size, paper type, sides, finishing, priority, tax, discount. Stays a pure function; keeps versioned `pricing_rules`; keeps the §82 snapshot behaviour that already works.
- **17.3 Pricing and product CRUD API.** Today `pricing_rules` has **no writer except the seed script** — shops cannot set their own prices through the product at all.
- **17.4 Customer records API** (§33/34) — staff create and search walk-in customers.
- **17.5 Counter-placed orders** (§4.2, §11 step 1) — `POST /shop/orders` with `creationSource = COUNTER`, staff uploading on a customer's behalf.
- **17.6 Manual payment recording** (§35) — cash/offline payment against an order with no PSP, driving the same `Payment` rows and order payment status.
- **17.7 Invoices and receipts** (§36) — PDF from the order plus its price snapshot, downloadable by customer and staff, authorization-checked like documents.

### Phase 18 — Job lifecycle split and allocation engine _(the spine)_

The load-bearing rule: **one writer per status column, and the job writer calls the order writer, never the reverse.**

- **18.1 `PrintJobStateMachine`** — new `packages/backend-shared/src/print-jobs/print-job-state-machine.ts`, sole writer of `print_jobs.status`, enforced by a second `no-restricted-syntax` rule in [eslint.config.js](eslint.config.js) mirroring the existing order-status one. `PrintJobStatus` gains `CREATED`, `WAITING`, `PAUSED`, `REASSIGNED` — additive; `CLAIMED`/`PRINTED` keep their names because those strings cross the agent wire. It accepts **no caller-supplied `tx`**, and unconditionally locks the `orders` row first, then job rows in ascending id order, making lock ordering structural rather than a convention.
- **18.2 Derived order status.** New pure `aggregateOrderStatus(jobs, { qualityCheck })`. Refactor [order-state-machine.ts](packages/backend-shared/src/orders/order-state-machine.ts) into `transition()` / `transitionWithin(tx, …)` / private `applyLocked()` — all three stay in the one ESLint-excluded file, so the single-writer invariant is untouched. Add order statuses `PREPARING`, `ASSIGNED`, `PAUSED`, `QUALITY_CHECK`; add events `SYNC_JOBS`, `QC_PASS`, `QC_FAIL`, `QC_REPRINT`; delete the 8 job-driven events. Aggregation precedence is **attention > progress > completion**: 3 jobs with 1 failed ⇒ `PRINT_FAILED`; 2 printed + 1 printing ⇒ `PRINTING`; all paused ⇒ `PAUSED`. A derived target equal to current returns early with **no write, no audit row, no notification**.
- **18.3 Order item explosion** — pure `explode-order-items.ts`: `OrderItem[] → PrintJobDraft[]` (§64). `acceptOrder`'s sideEffect explodes, then allocates each.
- **18.4 `allocatePrinter()`** — pure, no Prisma, no Nest, no clock. Checks status, capabilities, paper size and type, colour, duplex, page capacity, queue depth, page limit, paper availability, operator availability (§19). Deterministic tie-break: fewest queued pages → fewest queued jobs → oldest registration → id ascending. `allowUnknownCapabilities` is `false` for auto, `true` for manual override.
- **18.5 Wire allocation into dispatch**, retiring the `findFirst`. Change `idempotencyToken` to `${orderItemId}:${attempt}` so one-dispatch-per-item-per-attempt becomes a database guarantee.
- **18.6 Blocked jobs** (§79) — `BlockedReason` enum (`NO_COMPATIBLE_PRINTER`, `PRINTER_OFFLINE`, `PRINTER_DISABLED`, `PAGE_LIMIT_REACHED`, `NO_PAPER`, `OPERATOR_UNAVAILABLE`, `MANUAL_APPROVAL_REQUIRED`) surfaced on the job.
- **18.7 Manual allocation and override audit** (§20, §80) — who, when, previous printer, new printer, reason, on every reassignment and every automation override.
- **18.8 Queue priority and ordering** (§17/18) — NORMAL/HIGH/URGENT, deterministic ordering, queue position API. Today ordering is a single `orderBy: { createdAt: "asc" }` in [agent-jobs.service.ts:211-218](services/api/src/agents/agent-jobs.service.ts#L211-L218).
- **18.9 Operator allocation** (§21) — manual plus optional automatic, considering availability, workload, printer assignment, permissions and shift.
- **18.10 Equivalence and concurrency suites.** `single-job-equivalence.e2e-spec.ts` replays every path the 35 existing suites drive and asserts the derived order status equals what the deleted explicit table produced — this gates everything else. Plus an exhaustive purity matrix over `aggregateOrderStatus` (every multiset of ≤3 statuses × 4 QC states) asserting totality and **monotonicity**, and a 20-iteration concurrent-report test asserting exactly one transition, one APP plus one EMAIL notification, and zero deadlocks.

Ships behind `shops.multiItemEnabled` (default false) so production orders keep taking exactly one synthetic OrderItem until 18.10 is green.

### Phase 19 — Page limits and failover

- **19.1** Migration — per-printer `pageLimit`, `pageLimitEnabled`, limit period, plus a `printer_page_usage` counter with period reset.
- **19.2** Enforcement inside `allocatePrinter`, **gated by the enable/disable toggle** (§22/23/24). §106 scenarios 3 and 4 are precisely "enabled excludes the printer" and "disabled does not block".
- **19.3** Usage accrual on job completion; §41's "remaining allowance" becomes real.
- **19.4 Automatic handoff** (§25) — page limit reached, printer offline, printer error, paper unavailable, printer disabled ⇒ find another suitable printer.
- **19.5 Queue recovery worker** (§78) — extend [printer-offline-sweep.processor.ts](services/worker/src/printer-offline-sweep/printer-offline-sweep.processor.ts), which today flips printers `OFFLINE` and **does not touch print jobs at all**. Also rewrite [print-timeout.processor.ts](services/worker/src/print-timeout/print-timeout.processor.ts), whose order-level query is wrong once an order can hold both a printing and a stuck queued job — sweep `print_jobs` grouped by order, one `transitionMany` per order, never a per-job loop, which would invert lock order.

### Phase 20 — Inventory and suppliers

- **20.1** Migration — `inventory_items` (§26) and `inventory_movements` (§27) with an audit record per movement.
- **20.2** Inventory API with concurrency-safe stock math (§100) — row locks, never read-modify-write.
- **20.3** Paper availability gate in allocation (§28), honoured only when inventory tracking is enabled.
- **20.4** Consumption on job completion.
- **20.5** Low-stock alert worker, notifications and dashboard surfacing (§32).
- **20.6** Suppliers and supplier products (§29/30), many-to-many with inventory items.
- **20.7** Purchase orders (§31).

### Phase 21 — Production lifecycle completion

- **21.1** Pause and resume a job (§65, operator action).
- **21.2** Failure reasons (§66) — printer error, paper jam, wrong paper, poor quality, file problem, ink/toner, hardware — recorded as a picker, matching the existing `ShopRejectionReason` precedent.
- **21.3** Quality check (§68/69) — per-business toggle, Passed/Failed/Needs-reprint, blocking final completion.
- **21.4** Reprint (§67) — references the original job, records reason, user, time and additional cost.
- **21.5** Delivery (§71) — address, status, courier, tracking, fee, as an optional workflow.
- **21.6** JPG/PNG upload (§8) — extend the magic-byte gate in [document-processing.service.ts](services/worker/src/document-processing/document-processing.service.ts), which today hard-asserts `%PDF-`.
- **21.7** DOCX (§8) — LibreOffice headless conversion **server-side in the worker**, so the agent only ever receives PDF or images. New container dependency in [worker.Dockerfile](infrastructure/docker/worker.Dockerfile) and the production compose file.

### Phase 22 — Business and automation settings

- **22.1** Migration — `shop_settings` (§75): currency, tax, operating hours, notification settings, inventory rules.
- **22.2** Automation toggles (§76) — automatic printer assignment, operator assignment, queue management, inventory alerts, notifications, printer failover, page limit enforcement. **Every automatic path reads its toggle**; §122 requires manual intervention to always remain available.
- **22.3** Printer automation rules (§77) as ordered configuration feeding `allocatePrinter`.
- **22.4** Settings-safety regression suite (§81/82) — a price change must not alter a confirmed order; a rule change must not silently re-route in-flight jobs.

### Phase 23 — `apps/shop-web` and the remaining surfaces

- **23.1** Scaffold `apps/shop-web` (Next.js App Router), reusing customer-web's BFF proxy pattern ([lib/authenticated-proxy.ts](apps/customer-web/src/lib/authenticated-proxy.ts)), `packages/design-tokens` and `packages/api-client`. Wire into turbo, CI and the Docker compose files.
- **23.2** Dashboards: business owner (§39), operator (§40), printer (§41), admin (§42) — aggregate endpoints plus pages. No aggregate endpoint of any kind exists today.
- **23.3** Queue screen (§110), order screen (§108), printer screen (§109).
- **23.4** Products, pricing, inventory, suppliers, staff and settings pages.
- **23.5** Reports (§72/73/74) — orders, revenue, printing volume, printer usage and failures, operator workload, paper consumption, supplier purchases. §74's caveat (descriptive, not judgmental about employees) is a copy requirement on the operator report.
- **23.6** Search (§43) and filters (§44), plus **pagination on every list endpoint** — every list in the system is currently unbounded.
- **23.7** Notification centre (§111) — notifications API, read/unread (`readAt` is never written today), deep links, in both apps.
- **23.8** `shop-mobile` — operator production flow, job-level actions, priority display, blocked-job reasons.

### Phase 24 — C++ printer agent (`apps/printer-agent-cpp`)

Built to parity **alongside** the Node agent, which keeps printing throughout. Depends only on Phase 15.6 freezing the wire contract, so it may be pulled forward to immediately after Phase 15 if wanted.

- **24.1 Scaffold and toolchain.** CMake + `vcpkg.json` manifest (curl, libsodium, sqlite3, nlohmann-json, pdfium), MSVC x64, C++20, Catch2 for unit tests. A `windows-latest` build job added to CI.
- **24.2 Config and paths.** Mirror `config/paths.ts`: the whole agent's state is exactly one directory, `%LOCALAPPDATA%\PrintAutomated`.
- **24.3 Device identity.** Ed25519 keypair via libsodium, private key sealed with **DPAPI** (`CryptProtectData`) — stronger than the Node agent's plain restricted-ACL file. Same `deviceId` + public-key registration shape.
- **24.4 Backend client.** libcurl over HTTPS, nlohmann/json, the full agent auth flow: register with pairing code → challenge → sign nonce → 15-minute agent JWT, cached 14 minutes, single-flighted (the Node agent hit a real nonce-clobbering race here; the fix ports over).
- **24.5 Heartbeat and printer discovery.** `EnumPrinters` + `DocumentProperties`/DEVMODE probing for **real** capabilities — colour, duplex and the actual supported paper sizes — replacing the Node agent's hardcoded `a4: true, a3: false`. Reports on the 15.6 heartbeat v2 schema.
- **24.6 Job ledger.** SQLite, WAL, `synchronous = FULL`; the claim is fsync'd **before** `print()`; a startup sweep marks unresolved rows `UNKNOWN` and never resubmits them. Ports `ledger.ts` semantics exactly — this is the duplicate-print protection and must not drift.
- **24.7 Job loop.** Long-poll `GET /agents/jobs?wait=20`, atomic claim, 409 means lost race, exponential reconnect backoff for both the heartbeat and job loops.
- **24.8 Document fetch.** Stream `GET /agents/jobs/:id/document` to a temp file with a restrictive DACL (the Win32 equivalent of `0600`), deleted by a scope guard on every path.
- **24.9 PDFium print filter.** `FPDF_LoadDocument` → `CreateDC("WINSPOOL", …)` with a `DEVMODE` carrying duplex, copies, paper size, colour and orientation → `StartDoc` → per page `StartPage` / `FPDF_RenderPage` / `EndPage` → `EndDoc`. Plus a GDI+/WIC path for the JPG/PNG added in 21.6. Page-range selection is applied at the render loop, not via a CLI string.
- **24.10 Print monitoring and failure classification.** `EnumJobs` for spooler-side state, combined with the in-process render result — a far better verdict than today's substring matching on `Win32_PrintJob` text ([print-job-tracker.ts:10-20](apps/printer-agent/src/printers/monitor/print-job-tracker.ts#L10-L20)). Safe/unsafe classification ported from `failure-classifier.ts`; unsafe failures never auto-retry.
- **24.11 Status reporting.** Idempotent `POST /agents/jobs/:id/status` with `Idempotency-Key: ${jobId}:${status}`, exponential backoff capped at 30s.
- **24.12 Tray and pairing UI.** `Shell_NotifyIcon` with a proper embedded icon resource — fixing the Node agent's tray, which never renders correctly and once crashed the process through `systray`'s unguarded JSON parse. Local pairing page on `127.0.0.1:7171`.
- **24.13 Housekeeping.** Temp sweeper (unconditional at startup, hourly with a 1-hour age floor) and ledger pruning (resolved rows past 30 days; `UNKNOWN` rows never pruned).
- **24.14 Installer — actually built.** Inno Setup reusing `setup.iss`'s proven structure: a single native exe (no `pkg` bundling, no SumatraPDF, no GPLv3 text), autostart `Run` key, config written post-install, uninstall removing `%LOCALAPPDATA%\PrintAutomated`. **Install Inno Setup on this machine, compile it, and verify a real install/uninstall cycle** — which 13.3 never did.
- **24.15 Parity gate and Node retirement.** Run every scenario the Node agent's 10 test files cover, print a real job, prove duplicate-print protection under a mid-print kill — then delete `apps/printer-agent/` and its turbo/CI entries.

> **Hardware note.** This machine has no physical printer (the same blocker that left 9.14 incomplete). Unlike `FakePrinterDriver`, the C++ path can be validated end-to-end against **Microsoft Print to PDF**, which is a genuine Windows driver — so PDFium → DC → spooler → driver is fully exercised, and only the physical-paper step remains a manual gate.

### Phase 25 — Acceptance and hardening

- **25.1** §106 scenarios 1–8 as one e2e suite. Scenarios 2–6 are impossible today and are the real proof this work landed.
- **25.2** §100 concurrency suite — concurrent allocation (one job never reaches two printers), concurrent inventory updates, two users mutating one job.
- **25.3** §105 coverage sweep across all fifteen named areas.
- **25.4** Authorization matrix v2 — the new roles × new resources cross-product, extending [authorization-matrix.e2e-spec.ts](services/api/test/authorization-matrix.e2e-spec.ts); `/security-review` over the full diff.
- **25.5** Rewrite [docs/definition-of-done.md](docs/definition-of-done.md) against the new PRD's §123 (28 criteria), each citing its commit and proving test; add a PRD conformance matrix; refresh `CONTEXT.md` and the architecture record.

---

## Critical files

| File                                                                                                                                           | Role                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [packages/backend-shared/src/orders/order-state-machine.ts](packages/backend-shared/src/orders/order-state-machine.ts)                         | Sole writer of `orders.order_status`; refactored in 18.2, not replaced                                                    |
| [services/api/prisma/schema.prisma](services/api/prisma/schema.prisma)                                                                         | 17 models today; roughly 15 added across Phases 15/17/19/20/22                                                            |
| [services/api/src/shop-orders/shop-orders.service.ts](services/api/src/shop-orders/shop-orders.service.ts)                                     | `dispatchToPrinter` (15.2, 18.5), `SHOP_ORDER_INCLUDE` `take: 1` (18.2)                                                   |
| [services/api/src/agents/agent-jobs.service.ts](services/api/src/agents/agent-jobs.service.ts)                                                 | Claim/report routed through the new job machine (18.1); the `updateMany` race-winner idiom must survive as the claim gate |
| [eslint.config.js](eslint.config.js)                                                                                                           | Single-writer `no-restricted-syntax` rules — a second added for `print_jobs.status`                                       |
| [apps/printer-agent/](apps/printer-agent/)                                                                                                     | The reference implementation Phase 24 ports from, then deletes                                                            |
| [apps/printer-agent/installer/setup.iss](apps/printer-agent/installer/setup.iss)                                                               | Installer structure reused in 24.14                                                                                       |
| [infrastructure/terraform/](infrastructure/terraform/)                                                                                         | Deleted in 14.2                                                                                                           |
| [services/worker/src/print-timeout/](services/worker/src/print-timeout/), [printer-offline-sweep/](services/worker/src/printer-offline-sweep/) | Both need rewriting for N-jobs-per-order                                                                                  |

Reuse rather than rebuild: `ShopScopeGuard` + `ShopMembershipService` + `ShopScopedRepository` for tenancy, `AuditService` + `redactMetadata` for audit, `OrderLockService` for Redis locks, `StorageService` + `CryptoService` + KMS for files, `AppException` for the typed error model, `IdempotencyInterceptor` for replay safety, `upsertJobScheduler` for sweeps.

---

## Verification

**Per sub-phase** — the existing discipline: TDD, a stated Done-when, and a commit only once it is verified.

**Per phase**

1. `pnpm -w lint && pnpm -w typecheck && pnpm -w test` clean.
2. `pnpm -w test:e2e` against real Postgres/Redis/MinIO/ClamAV (`pnpm dev:up` first).
3. Migrations verified with `prisma migrate status` plus a direct `\d <table>` via `docker exec … psql`. **`prisma migrate dev` cannot run in this environment** — hand-write `migration.sql` in a fresh timestamped folder, then `prisma migrate deploy` + `prisma generate`. Never `prisma migrate reset`.

**Phase gates**

- Phase 14 closes only when a full stack comes up from `docker-compose.prod.yml` and `/health/ready` returns 200 with no AWS dependency anywhere.
- Phase 18 closes only when `single-job-equivalence.e2e-spec.ts` is green and the concurrency test passes 20 consecutive iterations with zero `40P01` deadlocks.
- Phases 19 and 20 each close with their §106 scenario passing (3 and 4 for page limits; 5 and 6 for failover and blocked jobs).
- Phase 24 closes only when the C++ agent passes the Node agent's full scenario set **and** an installer built on this machine installs, pairs, prints and uninstalls cleanly.

**End-to-end, per the "verify the full journey" rule** — walk the real cross-phase journeys in a browser against the running stack, then confirm actual DB column values with a direct query rather than trusting a UI that may collapse two backend states into one visual state:

1. **Counter journey:** staff create a walk-in customer → place a multi-item order → record cash payment → jobs allocate to different printers → operator prints → QC → ready → complete → invoice downloads.
2. **Automation journey:** two capable printers, one at its page limit → allocation picks the other → disable that one mid-queue → queue recovery re-routes → disable both → job shows `BLOCKED` with a reason.
3. **Inventory journey:** set A4 stock to zero → a new A4 job blocks with `NO_PAPER` → restock → it allocates → stock decrements on completion → low-stock alert fires.
4. **Isolation journey:** Business B staff cannot see or touch any Business A record — orders, customers, printers, inventory, suppliers, products, reports.
5. **Agent journey:** install the C++ agent from its own installer on a clean profile → pair with a code → it appears in the shop's printer list with real probed capabilities → a job prints → kill it mid-print → confirm no duplicate on restart.

**Windows dev hygiene:** kill stale dev servers and check `redis-cli --scan --pattern "bull:*"` for backlog before re-running e2e — a stale `document-processing` backlog causes worker e2e `afterAll` timeouts that look like code regressions.

---

## Known risks

1. **Deleting 8 order events (18.2) is the largest breaking change in the plan.** It rewrites the hand-mirrored matrix in `order-state-machine.e2e-spec.ts` and touches every state-machine call site. Mitigated by the equivalence spec gating the phase and `multiItemEnabled` defaulting false.
2. **Deadlock risk** once four concurrent writers (N agents, timeout sweep, offline sweep, staff) converge on the derived write path. Mitigated structurally: the job machine accepts no caller `tx`, always locks `orders` first, and sweeps must go through `transitionMany`.
3. **Status flapping** if aggregation is non-monotonic — it would fire real customer notification pairs while tests asserting only a final status stay green. The monotonicity property test in 18.10 is specifically the guard.
4. **Losing managed AWS services (14.2).** RDS backups, ElastiCache failover, S3 durability and SES deliverability were doing real work. Docker Compose replaces them with volumes and containers, so backup, restore and mail deliverability become explicit responsibilities — 14.3 must cover a `pg_dump` schedule and a documented restore, or §104 regresses.
5. **PDFium vendoring (24.9)** — the vcpkg port and prebuilt binaries occasionally lag; pin an exact version and cache it in CI rather than fetching per build.
6. **The C++ port is a second implementation of proven-hard logic** — duplicate-print protection especially. 24.6 and 24.15 exist to prove parity rather than assume it; the Node agent stays shippable until they pass.
7. **Scope.** This is comparable in size to the original 0–13 build. Phases 15–20 are the load-bearing half; 21–23 are broad but mostly conventional CRUD and UI; 24 is self-contained and parallelisable.

---

## Execution log and plan adjustments (updated 2026-09-24, after Phase 18)

Findings from execution that change what later phases must do. Sub-phase numbers below refer to this plan.

### How Phases 14-18 actually went

- Every phase was followed by an adversarial `code-reviewer` pass and its findings fixed before moving on. Every phase hid real bugs: Phase 16 a privilege escalation and a TOCTOU race; Phase 17 an order-list conflation and an unproven concurrency claim; Phase 18 a silently disabled lint guard, enum drift, an aggregation regression, non-atomic job/order sync, retry re-printing already-printed items, and a dropped late agent report. Keep doing this. Verify a reviewer's critical claims yourself before fixing.
- Phase 18 shipped as `eb03fa1`..`bb9a08a` plus review-fix commits 18.11-18.27, not one commit per sub-phase: the second lint guard fails every existing job-status writer, so the guard and the migrations off those writers had to land together. `shops.multi_item_enabled` is still `false` by default and must stay so until 19.5's sweep-race tests exist.
- Guards now enforced: `pnpm lint` runs `scripts/verify-lint-guards.mjs` (proves both single-writer lint rules actually fire); `services/api/src/common/enum-mirror.spec.ts` (Prisma vs `packages/types` enums); `single-writer-raw-sql.spec.ts` (raw SQL blind spot). `turbo.json` now declares root config files as cache inputs.

### Requirements added to later phases

- **19.2 / 19.3:** define ONE pages-per-job measure (`resolved page count x copies`) in a single pure helper used by allocation, queue-load and usage accrual. Today `dispatchToPrinter`'s load query uses `pageCount x (orderItem?.quantity ?? 1)` (under-counts a legacy job with no order item) and `allocatePrinter` receives bare `pageCount` for `maxJobPages`. `PrinterCandidate`'s page-limit / paper / operator fields are wired but nothing populates them yet: 19.2 populates the page-limit ones. Accrue usage inside the job machine's own transaction on the PRINTED transition (including staff `RESOLVE_UNKNOWN_PRINTED`), so it is atomic and counted once.
- **19.4:** automatic failover must be opt-in per shop (a `shops` flag defaulting to `false`, like `multiItemEnabled`), folded into `shop_settings` by 22.1. Section 122 requires every automatic path to be overridable.
- **19.5 (must include):**
  - The sweep-race tests the risk list always required and Phase 18 did not write: the print-timeout sweep and the offline sweep each racing a staff retry, via `Promise.all`.
  - **Late agent reports must not be dropped.** The pre-Phase-18 `reportStatus` wrote the reported status onto the job row unconditionally, so a late `PRINTED` from an agent whose job had already timed out left a job row saying `PRINTED` (the order stayed `PRINT_FAILED`, so a blind Retry could still reprint, but the evidence existed). The job machine correctly rejects illegal transitions, but `reportStatus` then swallows the report, so the fact that paper came out is lost. Fix: a late `PRINTED` (or `UNKNOWN`) on a live TIMEOUT/FAILED job moves it to UNKNOWN (add the edge) so the order derives `PRINT_STATUS_UNKNOWN` and staff must resolve it; a late report on a superseded/REASSIGNED job is audited and logged at warn. Duplicate printing is this product's cardinal rule.
  - Worker e2e verification: the 18.16 / 18.27 worker e2e cases are written but were never run (see Environment below).
- **22.2:** `dispatchToPrinter` has no automation toggle around auto-allocation (section 122).
- **25:** isolate the e2e infrastructure. Tests share Postgres and Redis with dev, which caused: a live worker draining test queues (`Expected length: 1, Received length: 0`), leftover-fixture FK failures in `authorization-matrix.e2e-spec.ts`'s `afterAll`, and a Redis `notifications` backlog of 1,000+ jobs nobody drains. Use a separate Redis DB index and a separate Postgres database for e2e.
- **Minor, tracked:** `attempt` is computed by a count outside the order lock (bounded by the unique idempotency token); the rewritten `services/worker/test/print-timeout.e2e-spec.ts` runs a global sweep against the shared DB, so another suite's stale job can make it throw spuriously.

### Environment (as of this entry)

A hung `jest test/print-timeout` process tree (sh 1364 -> pnpm 7988 -> cmd 16044 -> jest 1788, started 07:51 on 2026-09-24) is pegged at ~100% CPU and cannot be removed by the agents (the safety classifier denies the kill, correctly). It is a live worker on the shared Redis, so `services/worker` e2e suites hang until it is stopped and the stale `bull:*` backlog is cleared. Until then verify worker logic through the worker unit specs and API-level mirrors.

### Phase 19 (19.1-19.4) outcome and decisions (updated 2026-09-24)

Shipped as `8d9bb2c`..`e300a0b`; review fixes are numbered 19.6-19.9 (19.5, the worker sweeps, is deliberately deferred until the stuck worker e2e process is cleared).

- **Page limits.** Per printer: `page_limit`, `page_limit_enabled` (default false: PRD 23's explicit toggle), `page_limit_period` (DAILY|WEEKLY|MONTHLY, UTC, ISO week from Monday). Usage lives in `printer_page_usage` keyed by (printer, period start), so rollover is implicit and needs no reset job. A printer is auto-ineligible when remaining allowance < the job's total pages; manual assignment ignores the limit (PRD 20).
- **The limit is a SOFT cap.** Usage counts _completed_ pages only, so jobs allocated together can overshoot; failover trigger (b) moves not-yet-claimed jobs away after each accrual but does not undo overshoot on claimed/printing ones. Switching a printer's period DAILY -> MONTHLY mid-month effectively resets its allowance (different period keys).
- **One page measure**, resolved page count x copies (`job-pages.ts`): allowance, queue-load and accrual use the total; `maxJobPages` ("maximum supported job size") compares the per-copy document pages, not pages x copies.
- **Accrual is inside the job machine's own transaction** on the PRINTED transition (and staff `RESOLVE_PRINTED`), by atomic `INSERT .. ON CONFLICT DO UPDATE`, so it is counted exactly once and rolls back with the transition.
- **Failover is opt-in**: `shops.auto_failover_enabled` (default false, DB-only until 22.1 folds it into `shop_settings`). New job event `UNALLOCATE` (QUEUED -> WAITING, clears the printer, records a blocked reason). The primitive `reevaluatePrinterJobs` lives in `packages/backend-shared` so the worker can call it; it only ever touches QUEUED jobs, never CLAIMED/PRINTING/PRINTED (an agent may already be printing).
- **Testing lesson.** The agent wrote some tests alongside the code and never watched them fail. Mutation-testing the key guarantees (ignore the failover flag; ignore usage in the limit) showed they do catch it, but do this for any guarantee whose test was not seen failing.

### Requirements added to 19.5 by the Phase 19 review

- Call `reevaluatePrinterJobs` from the worker's offline sweep (a printer going OFFLINE), and **re-allocate WAITING jobs when a printer recovers**: nothing does today, so a job UNALLOCATEd by failover stays WAITING until staff act.
- Everything already listed for 19.5 above (sweep-race tests, late agent reports routed to UNKNOWN, worker e2e verification) still applies.

### Update, 2026-09-24 evening: the environment blocker resolved

- The orphaned jest tree was removed by a machine restart (no agent or classifier could do it). **Every `services/worker` e2e suite now passes** (print-timeout 9, order-expiration, document-processing 1, send-email 3, document-retention 5, printer-offline-sweep 4), so the 18.16 and 18.27 worker e2e cases, previously "written but never run", are verified. The "hang" was environmental: a shared Redis with a 1,500+ job notification backlog and live workers, not a code fault.
- **e2e now runs in its own Redis logical database (DB 9)** by default (commit `906f67c`; `services/*/jest.setup.cjs`), so dev workers and stale backlogs on DB 0 cannot interfere with tests or be drained by them. This removes the Redis half of Phase 25's "isolate the e2e infrastructure" item; **Postgres isolation (a separate test database) remains for Phase 25.**
- The `notifications` backlog on DB 0 was drained by a peer session's dev worker (1,567 -> 0); ~7,100 stale completed-job keys remain there, harmless.
- 19.5 is therefore no longer blocked: worker e2e can be run (direct jest under `timeout`, as in CONTEXT.md rule 6).

## Phase 19 complete (2026-09-24 night): 19.10-19.19

- 19.10-19.12: e2e hardening, per-job failover containment, needsAttention grouping (independently verified).
- 19.13-19.17 (worker sweeps, §78): `LATE_REPORT` event (TIMEOUT/FAILED/REASSIGNED -> UNKNOWN); offline sweep uses `UPDATE..RETURNING` and fails over only opted-in shops (`auto_failover_enabled`), waking receiving agents; `reallocateWaitingJobs` recovers WAITING jobs for availability reasons only; Promise.all sweep-race suites; worker e2e suites drain the notifications queue before closing.
- Review (read-only, 8bf279e..2cd2e98): no critical findings; single-writer invariants and lock order hold.
- 19.18 (`05eff3d`): a late PRINTED on a superseded job now PAUSES the live successor (MANUAL_APPROVAL_REQUIRED) so it cannot print a second copy; audit `PRINT_JOB_LATE_PRINT_SUCCESSOR`. 19.19 (`cc33330`): recovery re-checks the failover opt-in under lock.
- **Carry-forward to 21.1:** there is no staff pause/resume endpoint yet; after RESUME a job is WAITING with `blockedReason` still MANUAL_APPROVAL_REQUIRED, so the endpoint must set a fresh reason/printer. Staff need a "held by late print" indicator (blockedReason + that audit action) in 23.8. `Notification` is customer-only; no staff notification model exists (consider in 23.7). `reevaluatePrinterJobs` reads the opt-in once (same pattern; low risk).
- **Incident:** a drift check with the dev DB as shadow DB wiped the shared dev schema (only seed data restored). CONTEXT.md rule 7.
- Environment: worker e2e "afterAll 5000ms" timeouts in a full run = stale notifications backlog in Redis DB 9; FLUSHDB it. NEXT: Phase 20.

## Phase 20 complete (2026-09-25): 20.1-20.10

- 20.1-20.7 (dba6e34..82be29e + test fix 4dd8b81): inventory items + append-only movement ledger; `applyStockMovement` is the ONLY writer of `inventory_items.quantity` (FOR UPDATE, atomic relative UPDATE, CHECK >= 0, idempotency key); paper gate behind `shops.inventory_tracking_enabled` (default false, flag-off byte-identical); consumption inside the job machine's PRINTED tx (soft: clamps, audits `INVENTORY_SHORTFALL`); low-stock alert worker; suppliers + supplier products; purchase orders with atomic idempotent receive. Composite (id, shop_id) FKs.
- Review (read-only) found no criticals; 3 warnings fixed: 20.8 (f4f3c11) idempotency keys now scoped by route + resolved params + principal (was a cross-tenant replay leak); 20.9 (0a3054d) consumption contained in a SAVEPOINT so a DB error cannot roll back PRINTED, low-stock sweep locks ORDER BY id SKIP LOCKED; 20.10 (047037e) PO rejects inactive supplier/item, payment on CANCELLED PO, STOCK_OVERFLOW 409.
- Carry-forwards: 23.x screens (inventory, suppliers, POs, low-stock widget from `GET inventory/summary`, alerts list, tracking toggle); show NO_PAPER blocked jobs with restock/reassign hint and `INVENTORY_SHORTFALL` / `INVENTORY_CONSUMPTION_FAILED` audit rows; send `Idempotency-Key` on stock movements; error codes INSUFFICIENT_STOCK, INVENTORY_SKU_TAKEN, SUPPLIER_PRODUCT_EXISTS, PURCHASE_ORDER_INVALID_STATE, PURCHASE_ORDER_TOTAL_TOO_LARGE, SUPPLIER_INACTIVE, INVENTORY_ITEM_INACTIVE, STOCK_OVERFLOW. 22.1 folds `inventory_tracking_enabled` (+ `auto_failover_enabled`) into `shop_settings` and adds an automation toggle around restock recovery. `inventory_alerts` doubles as staff notification (no staff notification model; consider in 23.7). `consumptionHook` is a test-only seam on JobTransitionContext. Idempotency keys are now per-principal. NEXT: Phase 21.

## Phase 21 part 1 complete (2026-09-25): 21.1-21.8 (numbering note: review fixes took 21.6-21.8, so the plan's 21.6 JPG/PNG and 21.7 DOCX are now 21.9 and 21.10)

- 21.1-21.5 (5f79399..ccb6320): pause/resume (`PAUSE_JOBS`, `RESUME_QUEUE` edge, resume re-allocates, late-print-held job needs `acknowledgeLatePrint`), failure reasons (`RECORD_JOB_FAILURE`), quality check (`QUALITY_CHECK`, behind `shops.quality_check_enabled`, flag-off identical), reprint (`REPRINT_JOBS`, `print_job_reprints` UNIQUE(original_job_id) backstop, new job via dispatchToPrinter), delivery (`MANAGE_DELIVERY`).
- Review (read-only): no reachable duplicate print, no cross-shop leak. Fixed: 21.6 (0857cc5) late-print hold now fails closed on the JOB ROW (new `HOLD` machine event; audit row informational only); 21.7 (032f82d) COMPLETE refused with 409 `REPRINT_IN_PROGRESS` while a live reprint exists, dispatch no longer touches qualityCheckStatus on READY/COMPLETED, MARK_READY consults the QC flag; 21.8 (abbef19) delivery address nulled with `addressRedacted: true` for roles without MANAGE_DELIVERY.
- Frontend carry-forwards (23.x): permissions PAUSE_JOBS, RECORD_JOB_FAILURE, QUALITY_CHECK, REPRINT_JOBS, MANAGE_DELIVERY; enums JobFailureReason, ReprintReason, DeliveryStatus (api-client/types), `QUALITY_CHECK_RESULTS` from validation; resume body `{printerId?, acknowledgeLatePrint?}` and confirm dialog on 409 `LATE_PRINT_ACK_REQUIRED`; send Idempotency-Key on reprint; `delivery.address` may be null; job summaries carry failureReason/failureNote/reprint; order has qualityCheckStatus/delivery; steer QC FAILED toward reprint (retry gives NO_RETRYABLE_ITEMS); "reprint in progress" indicator from printJobs[].reprint. Error codes: ILLEGAL_JOB_TRANSITION, LATE_PRINT_ACK_REQUIRED, ORDER_NOT_ACTIVE, JOB_NOT_RESUMABLE, RESUME_TARGET_STALE, PRINTER_NOT_AVAILABLE, PRINTER_CAPABILITY_MISMATCH, JOB_NOT_FAILED, QUALITY_CHECK_REQUIRED, REPRINT_JOB_INVALID, REPRINT_ALREADY_EXISTS, REPRINT_ITEM_IN_PROGRESS, REPRINT_IN_PROGRESS, ORDER_NOT_REPRINTABLE, NO_PRINTER_AVAILABLE, PAYMENT_NOT_CONFIRMED, DOCUMENT_NOT_READY, DELIVERY_* (NOT_FOUND, NOT_ALLOWED, CLOSED, STATUS_INVALID, COURIER_REQUIRED, ORDER_NOT_READY).
- Open: no API to toggle `quality_check_enabled` (22.1/22.2); no customer-facing delivery display or delivery notification; late PRINTED after successor already CLAIMED/PRINTING is only audited; reprint `additionalCostMinor` uncapped and audit-only. NEXT: 21.9 (JPG/PNG), 21.10 (DOCX), then Phase 22.
