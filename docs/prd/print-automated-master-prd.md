# PRINT AUTOMATED
## Complete Master Product Requirements Document

**Document type:** Master PRD / Single Source of Truth  
**Product name:** Print Automated  
**Version:** 1.0  
**Status:** Master Specification  
**MVP target:** 4 weeks  
**Primary market:** Local print shops + customers  
**Primary platforms:** Customer Web, Shop Mobile App, Printer Agent  
**Future platforms:** Customer Mobile App, Admin Web, Shop Web

---

# 1. PRODUCT DEFINITION

## 1.1 What is Print Automated?

Print Automated is a platform that automates the process of ordering and producing physical printed documents.

A customer submits a document digitally, specifies exactly how it should be printed, selects a print shop, pays, and tracks the job.

The selected print shop receives the order through the Print Automated Shop App.

After payment is verified and the shop approves the order, the Print Automated Printer Agent installed on the shop's computer communicates with the physical printer and executes the print job.

### Core concept

**Digital document → digital order → payment → shop approval → automated printing → physical document**

---

# 2. PRODUCT VISION

## Vision

Make printing as simple as ordering anything else online.

A customer should not need to:

- travel to a shop just to submit a file,
- carry a USB drive,
- send documents through WhatsApp,
- manually explain printing requirements,
- wait while an employee downloads a file,
- calculate printing costs manually,
- repeatedly ask whether the document is ready.

Print Automated turns the traditional print shop into a digitally connected, automated service.

---

# 3. NORTH STAR

## Customer promise

> **Upload it. Configure it. Pay. Pick it up.**

## Shop promise

> **Receive it. Verify it. Print it. Complete it.**

## Platform promise

> **Digital document in → physical document out.**

---

# 4. PROBLEM

## 4.1 Customer problems

Traditional printing requires unnecessary physical interaction.

Typical process:

```text
Customer has document
        ↓
Find print shop
        ↓
Travel to shop
        ↓
Transfer document
        ↓
Explain requirements
        ↓
Wait
        ↓
Pay
        ↓
Receive document
```

Problems:

- wasted travel,
- queues,
- file-transfer friction,
- privacy concerns,
- communication mistakes,
- incorrect print configuration,
- uncertain pricing,
- uncertain completion time.

---

# 5. SHOP PROBLEMS

Print shops frequently depend on manual processes.

Typical workflow:

```text
Customer sends file
        ↓
Employee downloads file
        ↓
Employee opens file
        ↓
Employee asks requirements
        ↓
Employee calculates price
        ↓
Employee receives payment
        ↓
Employee sends print command
        ↓
Employee checks printer
        ↓
Employee informs customer
```

Problems:

- repetitive work,
- human error,
- payment confusion,
- printer failures,
- poor queue management,
- difficult order tracking,
- no standardized workflow,
- limited operational visibility.

---

# 6. SOLUTION

Print Automated creates a controlled digital workflow:

```text
CUSTOMER
   │
   ▼
Upload document
   │
   ▼
Configure print
   │
   ▼
Select shop
   │
   ▼
Calculate price
   │
   ▼
Pay
   │
   ▼
BACKEND
   │
   ▼
Payment verified
   │
   ▼
SHOP APP
   │
   ▼
Staff approves
   │
   ▼
PRINT JOB
   │
   ▼
PRINTER AGENT
   │
   ▼
PHYSICAL PRINTER
   │
   ▼
Printed document
```

---

# 7. PRODUCT COMPONENTS

Print Automated consists of four primary software components.

## 7.1 Customer Web

Used by customers.

Responsibilities:

- account management,
- document upload,
- print configuration,
- shop discovery,
- price calculation,
- payment,
- order tracking,
- order history.

---

## 7.2 Shop Mobile App

Built using:

**Expo + React Native**

Used by:

- shop owners,
- managers,
- counter employees.

Responsibilities:

- incoming orders,
- payment verification,
- job approval,
- print monitoring,
- printer monitoring,
- order completion,
- operational alerts.

---

## 7.3 Printer Agent

A lightweight application installed on a shop computer.

Responsibilities:

- authenticate with Print Automated,
- register local printers,
- maintain connection,
- receive print jobs,
- securely obtain documents,
- send documents to printers,
- monitor printing,
- report success/failure,
- prevent accidental duplicate printing,
- clean temporary files.

---

## 7.4 Backend Platform

The central source of truth.

Responsibilities:

- authentication,
- authorization,
- shops,
- users,
- documents,
- orders,
- pricing,
- payments,
- print jobs,
- printer agents,
- notifications,
- queues,
- auditing,
- security.

---

# 8. USERS

## 8.1 Customer

Needs documents printed.

Examples:

- student,
- office employee,
- job applicant,
- teacher,
- business user,
- general consumer.

---

## 8.2 Counter Staff

Works at the physical shop.

Primary objective:

> Process orders quickly and correctly.

---

## 8.3 Shop Manager

Manages operations.

Responsibilities:

- staff,
- printers,
- pricing,
- orders,
- shop status.

---

## 8.4 Shop Owner

Owns one or more shops.

Responsibilities:

- business configuration,
- financial information,
- employees,
- printers,
- reporting.

---

## 8.5 Platform Administrator

Manages Print Automated itself.

Responsibilities:

- users,
- shops,
- payments,
- disputes,
- system health,
- abuse,
- platform configuration.

---

# 9. USER ROLES

```text
CUSTOMER
SHOP_OWNER
SHOP_MANAGER
SHOP_COUNTER
ADMIN
```

Permissions must be server-side.

The client application must never be trusted to enforce authorization.

---

# 10. MVP GOALS

The MVP must prove the complete business loop.

## Primary goal

A customer can submit and pay for a document and a participating shop can automatically print it.

## MVP success condition

```text
Customer
   ↓
Upload
   ↓
Configure
   ↓
Pay
   ↓
Shop receives
   ↓
Staff approves
   ↓
Printer receives
   ↓
Physical printing
   ↓
Customer collects
```

---

# 11. MVP NON-GOALS

Do not allow the MVP to expand unnecessarily into:

- AI document editing,
- OCR,
- customer native mobile app,
- delivery marketplace,
- loyalty,
- advanced subscriptions,
- enterprise billing,
- every printer brand/model,
- advanced finishing,
- complex analytics,
- multi-country taxation.

---

# 12. CUSTOMER EXPERIENCE

## 12.1 Landing Page

The landing page must immediately explain:

**What Print Automated does.**

Primary CTA:

**Start Printing**

Secondary CTA:

**For Print Shops**

---

# 13. CUSTOMER AUTHENTICATION

Customer can:

- register,
- log in,
- log out,
- recover account,
- manage profile.

Minimum profile:

```text
id
name
email
phone
status
created_at
updated_at
```

---

# 14. DOCUMENT UPLOAD

## MVP format

Primary supported format:

**PDF**

Additional formats can be added later.

## Upload validation

System must validate:

- extension,
- MIME type,
- file signature,
- file size,
- document integrity.

## Document processing

After upload:

```text
Upload
 ↓
Validate
 ↓
Process
 ↓
Count pages
 ↓
Generate metadata
 ↓
Store securely
```

---

# 15. DOCUMENT SECURITY

Documents are potentially sensitive.

Therefore:

- HTTPS/TLS in transit,
- encrypted storage,
- controlled access,
- short-lived access URLs,
- strict authorization,
- retention policy,
- automatic deletion.

The database should store document metadata rather than raw document binaries.

---

# 16. PRINT CONFIGURATION

Customer must be able to configure:

### Pages

- all pages,
- selected page range.

### Copies

- 1,
- 2,
- 3,
- etc., within configured limits.

### Paper

MVP:

- A4.

Future:

- A3,
- Letter,
- Legal,
- custom shop-supported formats.

### Color

- B&W,
- Color.

### Sides

- single-sided,
- double-sided.

### Orientation

- portrait,
- landscape.

---

# 17. SHOP DISCOVERY

Customer can see available participating shops.

Each shop can expose:

- name,
- address,
- distance,
- operating status,
- estimated processing time,
- supported print capabilities.

MVP can use a simple shop list.

Advanced map/location discovery can follow later.

---

# 18. SHOP CAPABILITY MATCHING

A shop must only be offered for configurations it can support.

Example:

Customer requests:

```text
A3
Color
Duplex
```

The platform should only show shops capable of fulfilling those requirements.

---

# 19. PRICE CALCULATION

The backend is the authoritative pricing engine.

Never accept a client-calculated total as authoritative.

Conceptual formula:

```text
page price
× pages
× copies
+
color surcharge
+
other print charges
+
platform fee
+
optional delivery fee
=
total
```

---

# 20. PRICE SNAPSHOT

When the customer creates an order, the exact price configuration used must be stored with the order.

If the shop later changes its price:

**Existing orders must not change.**

---

# 21. ORDER CREATION

An order is created after the customer confirms:

- document,
- print settings,
- shop,
- calculated price.

Order receives:

- internal UUID,
- human-readable public order number.

Example:

```text
PA-20260907-000123
```

---

# 22. CHECKOUT

Customer sees:

```text
Document
assignment.pdf

Pages
10

Copies
2

Paper
A4

Color
B&W

Sides
Double-sided

Shop
Example Printing

Total
Rs. XXX
```

CTA:

**Pay & Place Order**

---

# 23. PAYMENT

Payment provider must be abstracted behind a payment service.

Conceptually:

```text
Customer
   ↓
Checkout
   ↓
Payment Provider
   ↓
Provider Webhook
   ↓
Print Automated Backend
   ↓
Payment Verified
```

The browser/mobile client response must **not** be the final authority for payment success.

The backend verifies payment through the payment provider.

---

# 24. PAYMENT STATES

```text
PENDING
AUTHORIZED
PAID
FAILED
CANCELLED
REFUND_PENDING
REFUNDED
REFUND_FAILED
```

---

# 25. ORDER STATES

Recommended state machine:

```text
DRAFT
 ↓
UPLOADED
 ↓
PAYMENT_PENDING
 ↓
PAID
 ↓
WAITING_FOR_SHOP
 ↓
SHOP_ACCEPTED
 ↓
QUEUED_FOR_PRINT
 ↓
PRINTING
 ↓
PRINTED
 ↓
READY_FOR_COLLECTION
 ↓
COMPLETED
```

Failure states:

```text
PAYMENT_FAILED
SHOP_REJECTED
PRINT_FAILED
PRINT_STATUS_UNKNOWN
CANCELLED
EXPIRED
```

---

# 26. PAYMENT AND ORDER STATE SEPARATION

Payment and print status must remain separate.

Example:

```text
payment_status = PAID

order_status = PRINT_FAILED
```

This is required for correct refunds and operational handling.

---

# 27. CUSTOMER ORDER TRACKING

Customer sees human-readable progress.

Example:

```text
✓ Order created
✓ Payment confirmed
✓ Shop accepted
● Printing
○ Ready for collection
○ Completed
```

Do not expose internal infrastructure terminology.

---

# 28. CUSTOMER ORDER HISTORY

Customer can view:

- order number,
- shop,
- date,
- amount,
- status,
- document name,
- basic configuration.

Documents themselves should not necessarily remain downloadable forever.

Retention rules apply.

---

# 29. SHOP APP

## Platform

Expo + React Native.

The app should be designed primarily for fast operational work rather than administration.

---

# 30. SHOP APP NAVIGATION

MVP:

```text
Home
Orders
Printers
More
```

---

# 31. SHOP HOME

Dashboard should answer:

- How many orders need attention?
- How many are printing?
- How many are ready?
- Are printers online?
- Are there failures?

Example:

```text
Pending
4

Printing
2

Ready
7

Printer
● Online
```

---

# 32. SHOP ORDER LIST

Orders grouped by operational state.

Example:

```text
Needs Attention
Printing
Ready
Completed
Failed
```

---

# 33. ORDER CARD

Order card contains:

```text
PA-000123

10 pages
2 copies
A4
B&W
Duplex

Rs. 400

Payment ✓ Verified

[Review]
```

---

# 34. ORDER DETAIL

Staff can see:

- order number,
- customer information where appropriate,
- document name,
- page count,
- copies,
- paper,
- color,
- duplex,
- total,
- payment state,
- printer assignment,
- job status.

---

# 35. PAYMENT VERIFICATION

The shop employee must have an unmistakable payment indicator.

Example:

```text
PAYMENT VERIFIED
✓ Rs. 400
```

If payment is pending:

```text
PAYMENT PENDING
```

A paid job cannot be accidentally treated as unpaid, and an unpaid job cannot be automatically printed.

---

# 36. SHOP APPROVAL

After reviewing the order:

### Accept

```text
ACCEPT & PRINT
```

### Reject

```text
REJECT ORDER
```

Rejection requires a reason.

Examples:

- printer unavailable,
- requested capability unavailable,
- shop temporarily unavailable,
- document issue.

---

# 37. PRINTING SCREEN

Show:

```text
PA-000123

Printer:
HP LaserJet

Printing

12 / 20 pages

60%

[Cancel]
```

Where printer hardware supports it, progress should be real.

Otherwise display:

**Printing...**

rather than fake progress.

---

# 38. PRINTER MANAGEMENT

Shop can view:

```text
Printer A
● Online
Ready

Printer B
● Offline

Printer C
⚠ Error
```

Actions:

- register printer,
- rename,
- enable/disable,
- remove,
- inspect status.

---

# 39. PRINTER AGENT

The Printer Agent runs locally at the shop.

Architecture:

```text
                CLOUD
                  │
             Secure API
                  │
                  ▼
          Printer Agent
           Shop Computer
                  │
           OS Print System
                  │
                  ▼
             Printer
```

The printer should not be exposed directly to the public internet.

---

# 40. AGENT REGISTRATION

When installed:

```text
Install Agent
      ↓
Login / Device Pairing
      ↓
Identify Shop
      ↓
Register Device
      ↓
Discover Printers
      ↓
Select Printer
      ↓
Ready
```

---

# 41. PRINTER DEVICE IDENTITY

Each agent receives a unique identity.

Example:

```text
device_id
shop_id
public_key
status
last_seen_at
created_at
```

Prefer cryptographic device identity over permanent shared passwords.

---

# 42. AGENT COMMUNICATION

Agent maintains a secure connection with backend.

Possible mechanisms:

- HTTPS polling,
- WebSocket,
- another authenticated real-time transport.

MVP can use reliable polling if it materially reduces complexity.

---

# 43. PRINT JOB DELIVERY

Process:

```text
Shop accepts order
       ↓
Backend authorizes job
       ↓
Job enters queue
       ↓
Agent notified
       ↓
Agent authenticates
       ↓
Agent obtains document
       ↓
Agent submits print
       ↓
Agent reports status
```

---

# 44. PRINT JOB AUTHORIZATION

A job can be printed only when:

```text
payment_status = PAID

AND

shop accepted order

AND

document available

AND

shop/printer authorized
```

---

# 45. PRINT JOB MODEL

```text
print_jobs

id
order_id
shop_id
printer_id
agent_id
status
attempt_count
started_at
completed_at
failed_at
error_code
error_message
created_at
updated_at
```

---

# 46. DUPLICATE PRINT PROTECTION

A physical print is irreversible.

Therefore the system must prevent duplicate execution.

Every print job needs a unique identity.

Example:

```text
job_id = PJ-12345
```

The agent must record whether that job has already been submitted.

Backend must use idempotency protections.

---

# 47. UNKNOWN PRINT STATE

Critical scenario:

```text
Agent sends job
       ↓
Printer may have started
       ↓
Network disconnects
       ↓
Backend receives no result
```

Do **not** blindly retry.

Set:

```text
PRINT_STATUS_UNKNOWN
```

Staff resolves whether to:

- confirm printed,
- retry,
- switch printer,
- cancel/refund.

---

# 48. PRINTER FAILURE

Example:

```text
Printer offline
      ↓
Agent detects failure
      ↓
Backend = PRINT_FAILED
      ↓
Shop notified
      ↓
Staff chooses:
   Retry
   Change Printer
   Cancel
   Refund
```

---

# 49. PRINTER CAPABILITIES

Printer capability model:

```json
{
  "color": true,
  "duplex": true,
  "a4": true,
  "a3": false
}
```

The system should eventually validate requested configuration against printer capabilities.

---

# 50. PRINTER QUEUE

MVP:

- one active job per printer,
- remaining jobs queued.

Future:

- automatic printer selection,
- load balancing,
- printer priority,
- parallel jobs.

---

# 51. DATABASE

Primary database:

**PostgreSQL**

Core entities:

```text
users
shops
shop_staff
documents
orders
print_jobs
printers
printer_agents
payments
payment_events
pricing_rules
notifications
audit_logs
```

---

# 52. USER TABLE

```text
users
-----
id
role
name
email
phone
status
created_at
updated_at
```

Authentication-specific secrets should be handled according to the selected authentication architecture.

---

# 53. SHOP TABLE

```text
shops
-----
id
name
address
latitude
longitude
phone
status
opening_hours
created_at
updated_at
```

---

# 54. STAFF TABLE

```text
shop_staff
----------
id
shop_id
user_id
role
status
created_at
updated_at
```

---

# 55. DOCUMENT TABLE

```text
documents
---------
id
owner_user_id
storage_object_id
filename
mime_type
size_bytes
page_count
checksum
encryption_version
status
created_at
expires_at
```

---

# 56. ORDER TABLE

```text
orders
------
id
public_order_number
customer_id
shop_id
document_id

print_configuration

subtotal
platform_fee
total_amount
currency

payment_status
order_status

created_at
updated_at
completed_at
```

---

# 57. PAYMENT TABLE

```text
payments
--------
id
order_id
provider
provider_payment_id
amount
currency
status
created_at
updated_at
```

---

# 58. PAYMENT EVENT TABLE

```text
payment_events
--------------
id
payment_id
provider_event_id
event_type
processed_at
created_at
```

Provider event IDs must be unique to prevent duplicate processing.

---

# 59. PRINTER TABLE

```text
printers
--------
id
shop_id
agent_id
name
manufacturer
model
capabilities
status
last_seen_at
created_at
updated_at
```

---

# 60. REDIS

Redis is a supporting system, not the durable business database.

Use Redis for:

### Caching

- shop status,
- printer status,
- pricing configuration.

### Queues

- print dispatch,
- notifications,
- background tasks.

### Locks

Prevent:

- duplicate processing,
- duplicate payment handling,
- concurrent state transitions.

### Rate limits

- login,
- upload,
- API requests.

### Temporary state

- short-lived verification state,
- job locks,
- temporary coordination state.

---

# 61. OBJECT STORAGE

Documents belong in object storage.

Example architecture:

```text
Application
    ↓
Object Storage
    ↓
Encrypted Document
```

PostgreSQL stores metadata and references.

---

# 62. DOCUMENT ENCRYPTION

Recommended architecture:

```text
Generate DEK
     ↓
Encrypt document with DEK
     ↓
Encrypt/wrap DEK with KMS master key
     ↓
Store encrypted document
     ↓
Store wrapped DEK
```

Do not store plaintext document encryption keys in PostgreSQL.

---

# 63. ENCRYPTION LAYERS

### Layer 1

TLS for network traffic.

### Layer 2

Object-storage encryption.

### Layer 3

Application-level document encryption where required.

This provides defense in depth.

---

# 64. DOCUMENT ACCESS CONTROL

Customer:

```text
Own documents/orders only
```

Shop:

```text
Documents belonging to active/authorized shop orders only
```

Agent:

```text
Only documents belonging to jobs assigned to its shop
```

Admin:

```text
Privileged, audited access
```

---

# 65. SIGNED DOCUMENT ACCESS

Documents should be delivered using:

- short-lived signed URLs, or
- authenticated streaming/download endpoints.

Permanent public document URLs are prohibited.

---

# 66. DOCUMENT RETENTION

Documents should not remain indefinitely.

Conceptual policy:

```text
Active order
    ↓
Document available

Completed order
    ↓
Retention period

Retention expires
    ↓
Secure deletion
```

Retention period must be configurable at the platform level.

---

# 67. DOCUMENT DELETION

Deletion should remove:

- object storage copy,
- encryption metadata,
- temporary local agent copy,
- processing artifacts.

Deletion jobs should be idempotent.

---

# 68. LOCAL AGENT DOCUMENT HANDLING

Agent should:

1. obtain authorized job,
2. download securely,
3. store temporarily,
4. print,
5. verify result,
6. delete temporary copy.

Temporary files must not remain indefinitely.

---

# 69. API

Recommended API domains:

```text
/auth
/users
/shops
/documents
/orders
/payments
/print-jobs
/printers
/agents
/notifications
```

---

# 70. AUTH API

```http
POST /auth/register
POST /auth/login
POST /auth/logout
POST /auth/refresh
POST /auth/recovery
```

---

# 71. DOCUMENT API

```http
POST /documents
POST /documents/:id/upload
GET /documents/:id
DELETE /documents/:id
```

---

# 72. ORDER API

```http
POST /orders
GET /orders
GET /orders/:id
POST /orders/:id/cancel
```

---

# 73. SHOP API

```http
GET /shop/orders
GET /shop/orders/:id
POST /shop/orders/:id/accept
POST /shop/orders/:id/reject
POST /shop/orders/:id/complete
```

---

# 74. PRINTER API

```http
GET /shop/printers
POST /shop/printers
PATCH /shop/printers/:id
DELETE /shop/printers/:id
```

---

# 75. AGENT API

```http
POST /agents/register
POST /agents/authenticate
POST /agents/heartbeat
GET /agents/jobs
POST /agents/jobs/:id/status
```

---

# 76. WEBHOOKS

Payment providers communicate with Print Automated through webhooks.

Example:

```text
POST /webhooks/payment
```

Requirements:

- signature verification,
- idempotency,
- event persistence,
- retry handling,
- auditability.

---

# 77. BACKGROUND WORKERS

Workers process:

- document processing,
- virus scanning,
- page counting,
- notifications,
- payment reconciliation,
- print dispatch,
- cleanup,
- expiration,
- document deletion.

---

# 78. NOTIFICATIONS

Events:

```text
PAYMENT_CONFIRMED
ORDER_ACCEPTED
PRINT_STARTED
PRINT_FAILED
PRINT_COMPLETED
READY_FOR_COLLECTION
ORDER_COMPLETED
```

MVP channels:

- application status,
- email where practical.

Future:

- push,
- SMS,
- WhatsApp.

---

# 79. CANCELLATION

Customer cancellation depends on order state.

Example:

```text
PAYMENT_PENDING
→ Allowed

WAITING_FOR_SHOP
→ Potentially allowed

PRINTING
→ Usually not allowed

COMPLETED
→ Not allowed
```

Business rules must be explicitly encoded.

---

# 80. REFUNDS

Refund is its own state machine.

```text
REFUND_PENDING
      ↓
REFUNDED
```

Failure:

```text
REFUND_FAILED
```

Refunds must be linked to the original payment/order.

---

# 81. AUTHORIZATION MODEL

Every protected resource requires:

```text
authenticated user
+
role permission
+
resource ownership
+
shop/tenant validation
```

Example:

```text
Counter Staff
   ↓
Shop A
   ↓
Order from Shop A
✓ allowed

Order from Shop B
✗ denied
```

---

# 82. MULTI-TENANCY

Each shop is an isolated tenant.

Shop-owned resources must be associated with `shop_id`.

Backend authorization must enforce tenant boundaries.

---

# 83. AUDIT LOGGING

Log important actions:

```text
LOGIN
LOGOUT
ORDER_CREATED
PAYMENT_CONFIRMED
ORDER_ACCEPTED
ORDER_REJECTED
PRINT_STARTED
PRINT_FAILED
PRINT_COMPLETED
REFUND_CREATED
DOCUMENT_ACCESSED
DOCUMENT_DELETED
PRINTER_REGISTERED
PRINTER_DISABLED
```

Audit entries:

```text
actor_id
action
resource_type
resource_id
timestamp
metadata
```

Never put secrets into audit logs.

---

# 84. SECURITY PRINCIPLES

Print Automated must follow:

### Zero trust

Never assume the client is trusted.

### Least privilege

Users and devices receive only required access.

### Defense in depth

Multiple security layers.

### Secure by default

Unsafe configuration should not be the default.

### Minimize data

Store only what is needed.

---

# 85. RATE LIMITING

Protect:

- login,
- signup,
- upload,
- checkout,
- API endpoints,
- agent connections.

Redis can support rate limiting.

---

# 86. FILE SECURITY

Uploaded files are untrusted.

Requirements:

- size limits,
- MIME validation,
- magic-byte/signature validation,
- malware scanning,
- filename sanitization,
- isolated processing,
- processing time/resource limits.

---

# 87. PAYMENT SECURITY

Never store unnecessary payment-card information.

Payment provider should handle sensitive payment credentials wherever possible.

Print Automated stores:

- provider reference,
- amount,
- status,
- timestamps,
- relevant metadata.

---

# 88. CUSTOMER PRIVACY

The platform should follow:

**Collect → Use → Delete**

Customer documents should not be retained longer than necessary.

---

# 89. OFFLINE BEHAVIOR

## Shop App

When offline:

- display offline status,
- preserve safe local UI state,
- prevent duplicate operations,
- synchronize when connectivity returns.

## Agent

When disconnected:

- retry connection,
- preserve safe local job state,
- avoid duplicate print execution.

---

# 90. AGENT RECONNECTION

Recommended behavior:

```text
Connection lost
     ↓
Backoff retry
     ↓
Reconnect
     ↓
Authenticate
     ↓
Synchronize state
     ↓
Resume
```

Use exponential backoff with reasonable limits.

---

# 91. STATE CONSISTENCY

Backend is the authoritative source for business state.

Client-side state is temporary.

Agent state is reconciled with backend state.

---

# 92. IDEMPOTENCY

Required for:

- payment webhooks,
- order creation,
- order acceptance,
- print commands,
- status updates,
- refunds.

Example:

```text
Same payment webhook received 5 times
        ↓
One financial operation
```

---

# 93. MOBILE UX PRINCIPLES

The Shop App should prioritize:

1. speed,
2. visibility,
3. touchability,
4. clear status,
5. minimal typing,
6. obvious actions.

Avoid unnecessary administrative screens.

---

# 94. DESIGN SYSTEM

Print Automated should use a unified design system across web and mobile.

Core tokens:

```text
Typography
Spacing
Radius
Elevation
Borders
Primary action
Success
Warning
Error
Neutral
```

The product UI should feel like one platform even though web and mobile are different surfaces.

---

# 95. CUSTOMER WEB SCREEN MAP

```text
Landing
 ├── Login
 ├── Signup
 │
 └── Customer Dashboard
      ├── New Print
      │    ├── Upload
      │    ├── Configure
      │    ├── Select Shop
      │    ├── Review
      │    └── Payment
      │
      ├── Orders
      │    └── Order Detail
      │
      └── Account
```

---

# 96. SHOP MOBILE SCREEN MAP

```text
Login
   ↓
Shop Home
 ├── Orders
 │    ├── Pending
 │    ├── Printing
 │    ├── Ready
 │    ├── Failed
 │    └── Completed
 │
 ├── Order Detail
 │
 ├── Printers
 │    ├── Printer Detail
 │    └── Add Printer
 │
 └── Settings
```

---

# 97. ADMIN SCREEN MAP — FUTURE

```text
Admin Dashboard
 ├── Users
 ├── Shops
 ├── Orders
 ├── Payments
 ├── Printers
 ├── Disputes
 ├── Audit Logs
 └── System Health
```

---

# 98. TECHNICAL ARCHITECTURE

```text
                         ┌───────────────────┐
                         │   CUSTOMER WEB    │
                         └─────────┬─────────┘
                                   │
                         ┌─────────▼─────────┐
                         │    BACKEND API    │
                         └─────────┬─────────┘
                                   │
             ┌─────────────────────┼─────────────────────┐
             │                     │                     │
             ▼                     ▼                     ▼
       PostgreSQL                Redis             Object Storage
             │                     │                     │
             └─────────────────────┼─────────────────────┘
                                   │
                         ┌─────────▼─────────┐
                         │ Background Worker │
                         └─────────┬─────────┘
                                   │
                         ┌─────────▼─────────┐
                         │    Print Queue    │
                         └─────────┬─────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │       Printer Agent         │
                    └──────────────┬──────────────┘
                                   │
                             Physical Printer


                    ┌──────────────────────┐
                    │    SHOP EXPO APP      │
                    └──────────┬───────────┘
                               │
                               ▼
                          BACKEND API
```

---

# 99. RECOMMENDED TECHNOLOGY

## Web

- React / Next.js
- TypeScript

## Mobile

- Expo
- React Native
- Expo Router
- TypeScript

## Backend

- Node.js
- TypeScript
- production-grade API framework

## Database

- PostgreSQL

## Cache / queues

- Redis

## Object storage

- S3-compatible storage

## Agent

- cross-platform desktop/local application
- Windows as first target

---

# 100. MONOREPO

Recommended structure:

```text
print-automated/

apps/
  customer-web/
  shop-mobile/
  printer-agent/
  admin-web/

services/
  api/
  worker/

packages/
  types/
  validation/
  api-client/
  pricing/
  config/

infrastructure/

docs/
  prd/
  architecture/
  api/
```

The repository can be simplified during MVP implementation if required.

---

# 101. ENVIRONMENTS

Use:

```text
development
staging
production
```

Never mix production credentials with development.

---

# 102. SECRETS

Sensitive configuration must be stored in a proper secrets mechanism.

Never commit:

- API keys,
- payment secrets,
- encryption keys,
- database passwords,
- authentication secrets.

---

# 103. OBSERVABILITY

Required:

### Logs

- application errors,
- worker errors,
- payment events,
- agent events,
- printer events.

### Metrics

- order completion,
- print success,
- print failure,
- queue length,
- payment success,
- agent connectivity.

### Health

API and worker health checks.

---

# 104. ERROR MODEL

Every important error should include:

```text
error_code
message
retryable
request_id
```

Customer-facing messages must be understandable.

Example:

Instead of:

```text
PRINTER_AGENT_CONNECTION_REFUSED
```

show:

> The shop's printer is temporarily unavailable. The shop has been notified.

---

# 105. BUSINESS MODEL

Basic MVP model:

```text
Customer pays
      ↓
Transaction
      ↓
Shop receives printing revenue
      ↓
Print Automated retains platform fee
```

Possible future models:

- commission,
- fixed transaction fee,
- shop subscription,
- premium features,
- enterprise plans.

---

# 106. SHOP ONBOARDING

Future/full product flow:

```text
Shop owner registers
       ↓
Business information
       ↓
Address
       ↓
Pricing
       ↓
Staff
       ↓
Printer Agent
       ↓
Printers
       ↓
Capabilities
       ↓
Activate shop
```

MVP can use administrator-assisted shop onboarding if faster.

---

# 107. SHOP OPERATING STATUS

Possible states:

```text
OPEN
CLOSED
BUSY
TEMPORARILY_UNAVAILABLE
SUSPENDED
```

Customer should not be able to submit orders to a shop that cannot currently accept them.

---

# 108. ORDER EXPIRATION

Orders that remain unpaid or unprocessed indefinitely should expire according to configurable rules.

Example:

```text
PAYMENT_PENDING
      ↓
timeout
      ↓
EXPIRED
```

---

# 109. PRINT TIMEOUT

Print jobs should have operational timeouts.

Example:

```text
QUEUED
   ↓
No agent response
   ↓
TIMEOUT
```

Staff receives an actionable error.

---

# 110. RETRY POLICY

Retries must be categorized.

### Safe retry

Network operation failed before print execution.

### Unsafe retry

Print command may already have reached printer.

Unsafe retries require state resolution.

---

# 111. ORDER REPRINT

Future feature.

Staff may request a reprint only through an explicit action.

The platform records:

```text
original_job_id
reprint_job_id
reason
actor
timestamp
```

This creates accountability.

---

# 112. CUSTOMER DISPUTES

Future system can support:

- wrong print,
- missing pages,
- poor quality,
- duplicate print,
- order not ready,
- refund request.

Every dispute references the order and payment.

---

# 113. ANALYTICS

## Platform

- orders/day,
- revenue,
- successful payments,
- successful prints,
- failed prints,
- active shops.

## Shop

- orders,
- revenue,
- average processing time,
- printer failures,
- completion rate.

## Customer

- orders,
- spending,
- repeat rate.

---

# 114. KEY PRODUCT METRICS

## Order completion rate

```text
completed orders
----------------
created orders
```

## Payment conversion

```text
paid orders
-----------
checkout attempts
```

## Print success rate

```text
successful print jobs
---------------------
print jobs
```

## Processing time

```text
ready time
-
payment confirmation time
```

## Repeat customer rate

Customers placing another order within the chosen measurement window.

---

# 115. MVP SUCCESS METRICS

Initial targets should be established after pilot testing.

Track:

- successful end-to-end print rate,
- average order processing time,
- payment failure rate,
- printer failure rate,
- duplicate-print rate,
- customer cancellation rate,
- repeat orders.

The most important technical metric is:

> **Paid orders successfully converted into correct physical prints.**

---

# 116. 4-WEEK IMPLEMENTATION PLAN

# WEEK 1 — FOUNDATION

## Backend

- project setup,
- PostgreSQL,
- Redis,
- authentication,
- user model,
- shop model,
- basic authorization,
- object storage,
- basic API.

## Web

- landing,
- authentication,
- upload UI.

## Expo

- project,
- navigation,
- authentication,
- shop shell.

## Infrastructure

- repository,
- environments,
- CI,
- logging.

---

# 117. WEEK 2 — CUSTOMER FLOW

Implement:

- PDF upload,
- processing,
- page count,
- configuration,
- pricing,
- shop selection,
- order creation,
- checkout,
- payment,
- payment webhook,
- customer order tracking.

Milestone:

> Customer can create and pay for an order.

---

# 118. WEEK 3 — SHOP + PRINTER

Implement:

### Expo

- dashboard,
- order queue,
- order detail,
- payment verification,
- accept/reject,
- printer status,
- printing state.

### Agent

- registration,
- authentication,
- printer discovery,
- communication,
- document retrieval,
- print execution,
- status reporting.

Milestone:

> Paid order can physically print at a shop.

---

# 119. WEEK 4 — HARDENING

Implement:

- failure handling,
- retries,
- duplicate protection,
- unknown print state,
- refunds,
- document cleanup,
- authorization testing,
- security testing,
- monitoring,
- end-to-end testing,
- deployment.

Milestone:

> Pilot-ready MVP.

---

# 120. MVP PRIORITY LEVELS

## P0 — Must have

```text
Authentication
PDF upload
Print configuration
Pricing
Shop selection
Payment
Order creation
Shop order queue
Payment verification
Shop approval
Printer Agent
Physical printing
Order tracking
Authorization
Encryption
Basic document retention
```

## P1 — Important

```text
Printer status
Notifications
Order history
Refunds
Failure recovery
Basic analytics
```

## P2 — Future

```text
Customer mobile app
Maps
Delivery
Subscriptions
AI
Loyalty
Advanced analytics
Multi-branch
Advanced finishing
```

---

# 121. GOLDEN PATH ACCEPTANCE TEST

The MVP must pass this exact scenario.

```text
1. Customer opens Print Automated.

2. Customer logs in.

3. Customer uploads a PDF.

4. System validates the PDF.

5. System detects page count.

6. Customer selects print settings.

7. Customer selects an active shop.

8. Backend calculates price.

9. Customer confirms checkout.

10. Customer pays.

11. Payment provider confirms payment.

12. Backend verifies webhook.

13. Order becomes PAID.

14. Shop receives order.

15. Counter employee opens order.

16. Employee sees PAYMENT VERIFIED.

17. Employee selects ACCEPT & PRINT.

18. Backend authorizes print job.

19. Printer Agent receives job.

20. Agent securely obtains document.

21. Agent sends document to printer.

22. Printer prints.

23. Agent reports success.

24. Backend updates print status.

25. Shop app displays printed status.

26. Staff marks order READY.

27. Customer sees READY FOR COLLECTION.

28. Customer collects document.

29. Staff marks COMPLETED.

30. Backend records completion.

31. Temporary document copies are deleted
    according to retention policy.
```

---

# 122. EDGE CASE ACCEPTANCE TESTS

The MVP must also test:

### Payment failure

```text
Payment fails
→ no printing
```

### Shop rejection

```text
Shop rejects
→ customer notified
→ refund logic triggered where applicable
```

### Printer offline

```text
Printer offline
→ no silent failure
→ staff notified
```

### Network interruption

```text
Network failure
→ reconnect
→ reconcile state
→ no duplicate print
```

### Duplicate webhook

```text
Webhook received twice
→ process once
```

### Unauthorized access

```text
Shop A staff
→ attempts Shop B document
→ denied
```

### Unknown print state

```text
Print command sent
→ connection lost
→ PRINT_STATUS_UNKNOWN
→ manual resolution
```

---

# 123. DEFINITION OF DONE

MVP is done only when:

- [ ] Customer authentication works.
- [ ] Shop authentication works.
- [ ] PDF upload works.
- [ ] Document validation works.
- [ ] Page count works.
- [ ] Print configuration works.
- [ ] Server-side pricing works.
- [ ] Shop selection works.
- [ ] Checkout works.
- [ ] Payment provider integration works.
- [ ] Webhook verification works.
- [ ] Orders are created correctly.
- [ ] Shop app receives orders.
- [ ] Staff can verify payment.
- [ ] Staff can accept/reject.
- [ ] Printer Agent can register.
- [ ] Agent can authenticate.
- [ ] Agent can communicate with backend.
- [ ] Agent can receive print jobs.
- [ ] Agent can securely obtain documents.
- [ ] Physical printer can print.
- [ ] Agent reports result.
- [ ] Customer receives status.
- [ ] Shop can mark ready.
- [ ] Shop can complete order.
- [ ] Printer failures are handled.
- [ ] Duplicate printing is protected.
- [ ] Unauthorized document access is blocked.
- [ ] Documents are encrypted.
- [ ] Document retention/deletion works.
- [ ] Critical events are audited.
- [ ] Payment operations are idempotent.
- [ ] Print operations are idempotent/safely reconciled.
- [ ] Production errors are observable.
- [ ] Golden path passes end-to-end.

---

# 124. FUTURE ROADMAP

## Phase 2

- customer mobile application,
- maps,
- better shop discovery,
- push notifications,
- more printer types,
- advanced printer management,
- order reprint.

## Phase 3

- delivery,
- scanning,
- photocopying,
- binding,
- lamination,
- photo printing,
- business accounts.

## Phase 4

- multi-branch shops,
- enterprise accounts,
- APIs,
- automated printer load balancing,
- predictive printer maintenance,
- advanced analytics.

---

# 125. LONG-TERM PLATFORM

Print Automated should eventually become more than an online printing marketplace.

It can become a **physical document automation platform**.

```text
                   PRINT AUTOMATED
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
       ▼                 ▼                 ▼
    Printing          Scanning          Copying
       │                 │                 │
       ▼                 ▼                 ▼
   Binding          Lamination        Document Photos
       │
       ▼
    Delivery
```

---

# 126. CORE DIFFERENTIATOR

The differentiator is not simply:

> "Upload a PDF online."

The differentiator is:

> **Automated connection between digital orders and physical printing infrastructure.**

Traditional model:

```text
Customer
   ↓
Human
   ↓
File transfer
   ↓
Human
   ↓
Printer
```

Print Automated:

```text
Customer
   ↓
Platform
   ↓
Payment
   ↓
Shop approval
   ↓
Printer Agent
   ↓
Printer
```

---

# 127. PRODUCT PRINCIPLES

## Principle 1 — Automation first

Every repetitive manual step should eventually be automatable.

## Principle 2 — Security first

Documents can contain highly sensitive information.

## Principle 3 — Human control where physical consequences exist

Printing is irreversible.

The system should automate execution while preserving clear human control over uncertain physical states.

## Principle 4 — Backend is the source of truth

Never trust client state for financial or operational decisions.

## Principle 5 — Simple customer experience

The customer should never need to understand the technical infrastructure.

## Principle 6 — Fast shop workflow

Counter staff should be able to process orders in seconds.

---

# 128. FINAL SYSTEM MODEL

```text
                    ┌────────────────────┐
                    │     CUSTOMER       │
                    │       WEB          │
                    └─────────┬──────────┘
                              │
                              ▼
                    ┌────────────────────┐
                    │    PRINT AUTO      │
                    │    BACKEND API     │
                    └─────────┬──────────┘
                              │
            ┌─────────────────┼──────────────────┐
            │                 │                  │
            ▼                 ▼                  ▼
      PostgreSQL            Redis          Object Storage
            │                 │                  │
            └─────────────────┼──────────────────┘
                              │
                     ┌────────▼────────┐
                     │ Background Jobs  │
                     └────────┬────────┘
                              │
                       ┌──────▼──────┐
                       │ Print Queue │
                       └──────┬──────┘
                              │
                     Secure Connection
                              │
                       ┌──────▼──────┐
                       │   PRINTER    │
                       │    AGENT     │
                       └──────┬──────┘
                              │
                              ▼
                       PHYSICAL PRINTER


              ┌──────────────────────────┐
              │      SHOP EXPO APP       │
              │                          │
              │ Orders • Payment • Print │
              │ Printers • Operations    │
              └────────────┬─────────────┘
                           │
                           ▼
                       BACKEND API
```

---

# 129. MASTER PRODUCT REQUIREMENT

Everything in Print Automated ultimately exists to support this transaction:

> **A customer pays for a correctly configured print job, an authorized shop approves it, and the correct physical document is printed reliably and securely.**

If a feature does not improve that transaction, protect it, operate it, monetize it, or scale it, it should not be allowed to delay the MVP.

---

# 130. MASTER MVP STATEMENT

### Print Automated MVP

**A secure digital-to-physical printing platform where customers upload PDFs, configure printing, select a local print shop, pay online, and track their order while participating shops use an Expo-based operational app and a local Printer Agent to verify, authorize, and automatically execute physical print jobs.**

**This is the master product specification for the Print Automated project.**