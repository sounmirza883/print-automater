PRINT AUTOMATED

MASTER PRODUCT REQUIREMENTS DOCUMENT

Version: 1.0
Product status: MVP specification
Primary goal: Build a working printing management and automation platform

1. PRODUCT OVERVIEW

Print Automated is a platform for managing printing work from order creation through printing, allocation, completion, and delivery.

The platform connects customers, printing businesses, operators, suppliers, printers, and administrators in one system.

The main purpose is to reduce manual work.

The system should help a printing business:

1. Receive printing orders.
2. Store customer and order information.
3. Prepare files for printing.
4. Assign work to suitable printers.
5. Manage printer queues.
6. Track paper and other consumables.
7. Allocate work between available printers or operators.
8. Handle printer capacity and page limits.
9. Track order progress.
10. Notify relevant users.
11. Keep business data protected.
12. Provide useful dashboards and reports.

The product should be designed so additional printing businesses, suppliers, printers, and automation features can be added later.

2. PRODUCT NAME

Print Automated

The name should be used consistently across the application.

3. PRODUCT VISION

Create a simple operating system for printing businesses where printing work can move through the business with minimal manual intervention.

4. PRIMARY USERS

4.1 Customer

A customer submits printing work.

Customer capabilities include:

Create account.
Log in.
Create an order.
Upload files.
Select printing requirements.
View price.
Submit order.
Track order.
Receive notifications.
View order history.
Download invoices or receipts where enabled.

4.2 Counter Staff

Counter staff handle customer orders.

They can:

Create orders.
Create customer records.
Upload customer files.
Modify order details.
Confirm payments.
Check order status.
Assign or reassign work.
Communicate order information to production staff.

4.3 Operator

An operator manages printing work.

They can:

View assigned jobs.
Accept jobs.
Start printing.
Pause jobs.
Complete jobs.
Report problems.
Report printer errors.
Report paper shortages.
Report job failures.
Transfer work when permitted.

4.4 Printer Manager

The printer manager controls printers.

They can:

Add printers.
Edit printers.
Enable or disable printers.
Set printer capabilities.
Set page limits.
Set supported paper types.
Set supported sizes.
Set color capability.
View printer status.
View printer queue.
Move jobs between printers.

4.5 Business Owner

The business owner manages the business.

They can:

Manage staff.
Manage printers.
Manage products.
Manage prices.
Manage suppliers.
View orders.
View revenue.
View production information.
View inventory.
Configure automation.
Configure limits.
View reports.

4.6 Supplier

Suppliers provide paper, ink, toner, spare parts, or other products.

Supplier functionality can be introduced progressively.

The supplier system should support:

Supplier profiles.
Supplier products.
Supplier pricing.
Stock availability.
Purchase records.
Supplier orders.
Supplier status.

4.7 System Administrator

The platform administrator manages the platform.

They can:

Manage businesses.
Manage users.
Manage system configuration.
View platform activity.
Manage integrations.
Manage security settings.
Manage subscriptions.
View system logs.
Disable accounts where required.

5. CORE PRODUCT STRUCTURE

The platform should use the following main areas:

Dashboard

Orders

Customers

Printing

Printer Queue

Printers

Operators

Inventory

Suppliers

Products

Pricing

Payments

Notifications

Reports

Settings

Administration

Not every section needs to be exposed to every user.

Role permissions control access.

6. ORDER MANAGEMENT

An order is the main object in the system.

Each order should have a unique order ID.

An order should contain:

Order ID.
Customer.
Business.
Creation date.
Order status.
Payment status.
Files.
Printing specifications.
Quantity.
Number of pages.
Paper type.
Paper size.
Color mode.
Single or double sided.
Finishing requirements.
Assigned printer.
Assigned operator.
Priority.
Price.
Notes.
Creation source.
Activity history.

7. ORDER STATUS

The order should support clear statuses.

Suggested statuses:

Draft

Submitted

Payment Pending

Confirmed

Preparing

Queued

Assigned

Printing

Paused

Quality Check

Ready

Completed

Cancelled

Failed

The system must keep an activity history when the status changes.

8. FILE MANAGEMENT

Customers or staff can upload printing files.

Supported files should initially focus on common formats such as:

PDF
JPG
PNG
DOCX

The system should be designed so more formats can be added later.

Each file should have:

File ID.
Original filename.
Storage location.
File type.
File size.
Upload time.
Uploader.
Order ID.
Security metadata.
Processing status.

9. FILE PROCESSING

After upload, the system should process the file.

The processing pipeline should be able to determine:

Number of pages.
Page dimensions.
Orientation.
Color information where possible.
File size.
Basic print compatibility.

The system should reject files that exceed configured limits.

10. SECURE FILE STORAGE

Uploaded files must not be stored as publicly accessible files.

Files should be stored in protected object storage.

The application should use encrypted storage.

Access should be controlled through authenticated requests or short-lived signed access links.

The database should store file metadata rather than unnecessarily storing large files directly.

11. ORDER CREATION FLOW

Customer or staff starts a new order.

Step 1

Select customer.

Step 2

Upload file.

Step 3

System processes file.

Step 4

Select printing requirements.

Step 5

System calculates price.

Step 6

Customer or staff confirms order.

Step 7

Payment is recorded or requested.

Step 8

Order enters production.

12. PRINTING OPTIONS

The product should support configurable printing options.

Paper size:

A4
A5
A3
Letter
Legal
Custom sizes where supported

Color:

Black and white
Color

Sides:

Single sided
Double sided

Quantity:

Number of copies

Paper type:

Standard paper
Premium paper
Card
Photo paper
Other configured types

Finishing:

None
Stapling
Binding
Cutting
Lamination
Other configured services

The exact available options depend on the business configuration.

13. PRODUCT CATALOG

Printing services should be represented as products or services.

Examples:

A4 black and white printing.
A4 color printing.
A3 color printing.
Photo printing.
Binding.
Lamination.
Stapling.

Each product can have:

Name.
Description.
Category.
Price.
Unit.
Available status.
Printer requirements.
Paper requirements.
Tax configuration.
Business ownership.

14. PRICING ENGINE

The pricing engine calculates the expected price before an order is confirmed.

Price can depend on:

Product.
Paper size.
Paper type.
Color.
Number of pages.
Number of copies.
Single or double sided.
Finishing.
Rush priority.
Additional services.
Tax.
Discount.

The pricing system must be configurable.

Prices should not be hardcoded into the application.

15. PRINTER MANAGEMENT

Every printer should have a printer profile.

Printer information:

Printer ID.
Printer name.
Model.
Location.
Connection type.
Status.
Supported sizes.
Supported paper types.
Color capability.
Duplex capability.
Maximum supported job size.
Current queue.
Current operator.
Daily page limit.
Remaining page allowance.
Maintenance status.

16. PRINTER STATUS

Printers should support statuses such as:

Online

Offline

Busy

Paused

Maintenance

Disabled

Error

Unknown

The system should not automatically assume a printer is available when its state is unknown.

17. PRINTER QUEUE

Every printer can have a queue.

The queue contains printing jobs waiting for that printer.

Each job should have:

Job ID.
Order ID.
Priority.
Pages.
Copies.
Required paper.
Required color mode.
Required printer capability.
Assigned operator.
Queue position.
Created time.
Expected completion.
Current status.

18. QUEUE PRIORITY

The system should support priority levels.

Normal

High

Urgent

Business owners can configure how priority affects queue ordering.

The system should maintain predictable ordering.

19. AUTOMATIC PRINTER ALLOCATION

The platform should be able to automatically select a suitable printer.

The allocation engine checks:

Printer availability.
Printer status.
Printer capabilities.
Paper availability.
Color capability.
Paper size.
Duplex support.
Current queue.
Page capacity.
Operator availability where required.
Business rules.

Only printers that satisfy the job requirements should be considered.

20. MANUAL ALLOCATION

Authorized staff can manually assign a job.

Manual assignment should override automatic allocation for that job.

The system should record:

Who assigned it.
When it was assigned.
Previous printer.
New printer.
Reason if provided.

21. OPERATOR ALLOCATION

Operators can be assigned to jobs.

The system should support manual assignment.

It should also support automatic assignment when enabled.

Automatic operator allocation can consider:

Operator availability.
Current workload.
Printer assignment.
Operator permissions.
Operator location.
Active shift.

22. PRINTER PAGE LIMIT SYSTEM

A business may configure a page limit for a printer.

For example:

Printer A can print 10,000 pages during a configured period.

The system tracks used pages.

When the limit is reached, the printer should stop receiving automatically assigned jobs if the limit rule is enabled.

23. PAGE LIMIT ENABLE AND DISABLE FEATURE

The page limit system must have an explicit enable and disable setting.

If the business does not enable the feature, the printer should continue operating without this allocation restriction.

If enabled, the system should enforce the configured limit.

24. PAGE LIMIT ALLOCATION

When a printer reaches its configured limit, the system should check other suitable printers.

If another printer is available, new work can be allocated there.

If no suitable printer is available, the job remains in the queue.

25. AUTOMATIC HANDOFF

The system should support automatic handoff when a printer becomes unsuitable.

Examples:

Printer reaches page limit.

Printer goes offline.

Printer reports an error.

Required paper is unavailable.

Printer is disabled.

The system should identify another suitable printer when possible.

26. PAPER INVENTORY

The system should track paper inventory.

Inventory records should include:

Item.
SKU.
Paper size.
Paper type.
Weight.
Current quantity.
Minimum quantity.
Maximum quantity.
Location.
Supplier.
Unit cost.
Last updated.

27. INVENTORY MOVEMENTS

The system should record inventory changes.

Examples:

Purchase.
Manual adjustment.
Consumption.
Return.
Transfer.
Correction.

Every movement should have an audit record.

28. PAPER AVAILABILITY

Before automatic printer allocation, the system should check whether the required paper is available when inventory tracking is enabled.

If the required paper is unavailable, the job should not be assigned to a printer that cannot fulfil it.

29. SUPPLIER MANAGEMENT

Businesses can maintain supplier records.

Supplier information:

Supplier name.
Contact information.
Products supplied.
Pricing.
Payment terms.
Status.
Notes.

30. SUPPLIER PRODUCTS

A supplier can provide multiple products.

The system should allow a business to associate inventory products with suppliers.

A product may have multiple suppliers.

31. PURCHASE ORDERS

A future version can support purchase orders.

The structure should support:

Purchase order ID.
Supplier.
Products.
Quantities.
Expected delivery.
Actual delivery.
Status.
Total cost.
Payment status.

32. INVENTORY ALERTS

The system should generate alerts when inventory reaches configured minimum levels.

Example:

A4 paper has reached the minimum stock level.

The alert can be shown on the dashboard.

Notifications can also be sent to authorized users.

33. CUSTOMER MANAGEMENT

Each customer should have a customer profile.

Customer data:

Customer ID.
Name.
Phone.
Email.
Company.
Address where required.
Order history.
Payment history.
Account status.

34. CUSTOMER ORDER HISTORY

Customers and authorized staff can view previous orders.

The history should show:

Order ID.
Date.
Amount.
Status.
Files where permitted.
Payment status.

35. PAYMENT MANAGEMENT

The system should support payment tracking.

Payment statuses:

Pending.
Paid.
Partially paid.
Refunded.
Failed.
Cancelled.

The initial MVP can support manual payment recording.

Online payment integration can be added later.

36. INVOICES AND RECEIPTS

The system should be able to generate an invoice or receipt.

It should contain:

Business information.
Customer information.
Order ID.
Items.
Quantity.
Unit price.
Subtotal.
Tax where applicable.
Discount.
Total.
Payment status.
Date.

37. NOTIFICATIONS

The platform should provide notifications for important events.

Examples:

Order received.
Payment received.
Order confirmed.
Printing started.
Printing paused.
Printing completed.
Order ready.
Printer failure.
Printer offline.
Paper shortage.
Inventory low.
Job reassigned.

38. NOTIFICATION CHANNELS

The architecture should support:

In-app notifications.

Email.

SMS or messaging integrations can be added later.

39. DASHBOARD

The main dashboard should provide a quick view of business activity.

Possible dashboard information:

Orders today.
Pending orders.
Printing now.
Completed orders.
Revenue.
Active printers.
Offline printers.
Low inventory.
Failed jobs.
Jobs waiting in queue.

Dashboard content should depend on the user's role.

40. OPERATOR DASHBOARD

The operator dashboard should focus on production.

It should show:

My assigned jobs.
Current job.
Waiting jobs.
Printer status.
Required paper.
Job priority.
Job instructions.
Completed jobs.

41. PRINTER DASHBOARD

The printer dashboard should show:

Printer status.
Current job.
Queue.
Pages printed.
Page limit.
Remaining page allowance.
Paper availability.
Errors.
Maintenance status.

42. ADMIN DASHBOARD

The platform administrator should see:

Businesses.
Users.
Orders.
System status.
Storage usage.
Integration status.
Errors.
Security events.
Subscription information.

43. SEARCH

The platform should provide global or section-based search.

Search should support:

Order ID.
Customer name.
Phone.
File name.
Printer.
Operator.
Supplier.
Product.

44. FILTERS

Orders should support filters such as:

Status.
Date.
Customer.
Priority.
Printer.
Operator.
Payment status.

45. AUDIT LOG

Important actions must be recorded.

Examples:

User login.
Order creation.
Order modification.
Order cancellation.
Printer assignment.
Printer reassignment.
Price change.
Inventory adjustment.
Permission change.
File access.
User creation.
User deletion.
Configuration change.

The audit log should contain:

Actor.
Action.
Object.
Timestamp.
Relevant metadata.

46. USER ROLES

The system should use role based access control.

Initial roles:

Platform Admin.

Business Owner.

Manager.

Counter Staff.

Operator.

Printer Manager.

Supplier.

Customer.

47. PERMISSIONS

Permissions should be granular.

Examples:

View orders.
Create orders.
Edit orders.
Cancel orders.
Assign jobs.
Manage printers.
Manage inventory.
Manage suppliers.
Manage prices.
View reports.
Manage users.
Manage settings.

A user should only see functions permitted by their role.

48. BUSINESS SEPARATION

The system should support multiple businesses.

Data belonging to one business must not be visible to another business.

Every major business-owned record should have a business or tenant relationship.

49. MULTI-TENANT ARCHITECTURE

The platform should be designed as a multi-tenant system.

Core tenant-aware records include:

Users.
Customers.
Orders.
Files.
Printers.
Operators.
Inventory.
Suppliers.
Products.
Pricing.
Payments.
Reports.

50. DATA SECURITY

Sensitive data should be protected.

Requirements:

Encrypted storage.

Encrypted network communication.

Strong authentication.

Role based access.

Tenant isolation.

Controlled file access.

Audit logging.

Secure session handling.

Server side authorization.

51. REDIS

Redis can be used where fast temporary access is useful.

Potential uses:

Job queues.

Temporary job state.

Caching.

Rate limiting.

Session related temporary data where appropriate.

Printer status cache.

Short-lived locks.

Notification queues.

Automatic allocation processing.

Redis should not be treated as the permanent source of truth for business records.

Permanent business data remains in the main database.

52. JOB QUEUE

Background jobs should be processed asynchronously.

Examples:

File processing.
PDF page counting.
Thumbnail generation.
Printer allocation.
Notifications.
Inventory alerts.
Report generation.

This prevents long-running work from blocking the main application.

53. LOCKING

The allocation system must prevent two processes from assigning the same printer capacity at the same time.

Short-lived distributed locks can be used where necessary.

The database remains authoritative.

54. REAL TIME STATUS

Where printer integrations support it, the system should update printer status automatically.

The UI should show recent status information.

If status becomes stale, the system should indicate that the status is not current.

55. PRINTER INTEGRATION

The architecture should allow integration with printers through a connector or local printing service.

The platform should not depend on one printer manufacturer.

The integration layer should abstract printer-specific communication.

56. LOCAL PRINT AGENT

A future local agent can run inside a printing business.

The agent can communicate with local printers and the cloud platform.

Possible responsibilities:

Discover printers.
Send print jobs.
Read printer status.
Report errors.
Report page counts.
Report consumable status.

57. CLOUD PLATFORM

The cloud platform manages:

Users.
Orders.
Files.
Pricing.
Business configuration.
Queues.
Allocation rules.
Inventory.
Notifications.
Reports.
Audit logs.

58. LOCAL TO CLOUD TRANSITION

The architecture should allow a printing business to move from local operation to cloud operation without rebuilding the whole system.

Local services should communicate with the central platform through secure APIs.

59. API ARCHITECTURE

The backend should expose structured APIs.

API areas include:

Authentication.

Users.

Businesses.

Customers.

Orders.

Files.

Printers.

Print jobs.

Queues.

Inventory.

Suppliers.

Products.

Pricing.

Payments.

Notifications.

Reports.

60. AUTHENTICATION

The system should support secure authentication.

Initial MVP:

Email and password.

The architecture should allow:

OTP.

Social login.

Single sign-on.

Multi factor authentication.

61. SESSION MANAGEMENT

Sessions must be securely managed.

The system should support:

Session expiration.
Logout.
Token rotation where applicable.
Protected API requests.
Role verification.

62. FILE ACCESS SECURITY

A user must not access another customer's file by changing an ID in a URL or API request.

Every file access request must verify:

User identity.
Business access.
Order access.
File permission.

63. DATABASE

A relational database should store structured application data.

Core tables or equivalent entities should include:

Businesses.

Users.

Roles.

Permissions.

Customers.

Orders.

OrderItems.

Files.

PrintJobs.

Printers.

PrinterQueues.

Operators.

Products.

Prices.

InventoryItems.

InventoryMovements.

Suppliers.

SupplierProducts.

Payments.

Notifications.

AuditLogs.

Settings.

64. ORDER AND PRINT JOB SEPARATION

An order and a print job should be separate concepts.

One order can contain multiple print jobs.

Example:

Order contains:

100 A4 black and white pages.

50 A4 color pages.

10 laminated pages.

These may require different production steps.

65. PRINT JOB LIFECYCLE

A print job should move through:

Created.

Waiting.

Queued.

Assigned.

Printing.

Paused.

Completed.

Failed.

Cancelled.

Reassigned.

66. FAILED JOB HANDLING

When a job fails, the operator should be able to select a reason.

Examples:

Printer error.
Paper jam.
Wrong paper.
Poor print quality.
File problem.
Ink or toner problem.
Hardware issue.

The system records the reason.

67. REPRINT

Authorized users should be able to create a reprint.

The reprint should reference the original print job.

The system should record:

Original job.
Reprint reason.
User.
Time.
Additional cost where applicable.

68. QUALITY CHECK

For businesses that use quality control, an order can enter Quality Check after printing.

The operator or authorized staff can mark:

Passed.

Failed.

Needs reprint.

69. ORDER COMPLETION

An order should only be marked completed after all required production work is finished.

If quality checking is enabled, the required check should be completed before the final status.

70. CUSTOMER READY STATUS

Once production is complete, the customer can receive an Order Ready notification.

The order then waits for pickup or delivery.

71. DELIVERY

Delivery can be supported as an optional workflow.

Order delivery information may include:

Delivery address.
Delivery status.
Courier.
Tracking number.
Delivery fee.

72. REPORTING

The system should provide reports for:

Orders.
Revenue.
Printing volume.
Printer usage.
Printer failures.
Operator workload.
Paper consumption.
Inventory.
Supplier purchases.

73. PRINTER PERFORMANCE

Printer reporting can include:

Pages printed.
Jobs completed.
Jobs failed.
Average job duration.
Downtime.
Page limit usage.

74. OPERATOR PERFORMANCE

Operator reporting can include:

Jobs assigned.
Jobs completed.
Jobs failed.
Average completion time.
Current workload.

Reports should be descriptive rather than used to make unsupported judgments about employees.

75. BUSINESS SETTINGS

Business owners can configure:

Business details.
Currency.
Tax.
Operating hours.
Products.
Pricing.
Printers.
Printer rules.
Page limits.
Inventory rules.
Notification settings.
User permissions.

76. AUTOMATION SETTINGS

Automation should be configurable.

Possible controls:

Automatic printer assignment.

Automatic operator assignment.

Automatic queue management.

Automatic inventory alerts.

Automatic notifications.

Automatic printer failover.

Automatic page limit enforcement.

Each automation feature should have an enable or disable control.

77. PRINTER AUTOMATION RULES

A business should be able to define rules such as:

Use printer with matching paper.

Avoid offline printers.

Avoid printers at page limit.

Prefer printers with shorter queues.

Prefer specific printer groups.

Require operator assignment.

78. QUEUE RECOVERY

If a printer becomes unavailable while jobs are waiting, the system should evaluate those jobs again.

Eligible jobs can be moved to another suitable printer.

Jobs that cannot be moved should remain visible as blocked.

79. BLOCKED JOBS

A blocked job should show why it cannot proceed.

Examples:

No compatible printer.

No paper.

Printer offline.

Printer disabled.

Required operator unavailable.

Manual approval required.

80. MANUAL OVERRIDE

Authorized users should be able to override automation.

Examples:

Force printer assignment.

Change priority.

Pause automation.

Move job.

Cancel job.

The system should record the override.

81. SETTINGS SAFETY

Configuration changes should not silently affect existing jobs unless explicitly designed to do so.

For example, changing a product price should normally affect new orders.

Existing confirmed orders should retain their confirmed price.

82. PRICE SNAPSHOT

When an order is confirmed, the system should save the price information used for that order.

Future price changes must not alter historical orders.

83. STORAGE ARCHITECTURE

Object storage should hold large files.

Database storage should hold metadata.

The architecture should support moving between storage providers later.

The application should use a storage abstraction layer rather than tightly coupling business logic to one provider.

84. ENCRYPTION

Files should be encrypted at rest using the storage provider's encryption capabilities.

Sensitive application data should use appropriate encryption where required.

Secrets must not be stored directly in source code.

85. SECRET MANAGEMENT

API keys, database credentials, encryption keys, and service credentials must be stored through environment secrets or a dedicated secret management system.

86. LOGGING

Application logs should capture useful technical information.

Logs should not expose sensitive file contents, passwords, authentication tokens, or unnecessary customer information.

87. ERROR HANDLING

The application should provide understandable errors.

Users should see:

What happened.

What they can do next.

Whether the action succeeded.

Technical details should remain in server logs where appropriate.

88. MOBILE AND WEB

The initial product should support a responsive web application.

The architecture should allow a mobile application to be added later.

A future mobile application can support:

Customer ordering.

Order tracking.

Operator work.

Notifications.

Printer monitoring.

89. MOBILE APP DIRECTION

If a native mobile app is later built, Expo and React Native can be used.

The backend APIs should be shared between web and mobile clients.

90. MVP SCOPE

The MVP should focus on the smallest working version that proves the core business workflow.

MVP should include:

Authentication.

Business account.

User roles.

Customer management.

Order creation.

File upload.

File storage.

Basic file processing.

Printing options.

Pricing.

Order status.

Printer management.

Printer queue.

Manual printer assignment.

Automatic printer allocation.

Operator assignment.

Page limit feature.

Page limit enable and disable.

Basic inventory.

Paper availability.

Notifications.

Dashboard.

Audit logging.

Encrypted file storage.

Redis for background processing where needed.

Basic reporting.

91. MVP EXCLUSIONS

The following can remain outside the first MVP:

Advanced supplier marketplace.

Complex purchasing automation.

Advanced accounting.

Full delivery management.

Large scale analytics.

AI document understanding.

Advanced predictive maintenance.

Full printer manufacturer coverage.

Complex subscription billing.

Multi-country tax systems.

Advanced mobile applications.

92. FOUR WEEK MVP PLAN

Week 1

Foundation.

Set up:

Project structure.

Database.

Authentication.

Business and user model.

Roles and permissions.

Basic dashboard.

Customer management.

Order model.

93. WEEK 2

Order and file workflow.

Build:

Order creation.

File upload.

Secure storage.

File processing.

Printing options.

Product catalog.

Pricing engine.

Order status.

Customer order history.

94. WEEK 3

Production system.

Build:

Printer management.

Printer capabilities.

Printer queue.

Print jobs.

Operator assignment.

Automatic allocation.

Page limits.

Printer enable and disable.

Manual reassignment.

Inventory basics.

95. WEEK 4

Automation and finishing.

Build:

Notifications.

Audit logs.

Dashboard improvements.

Reports.

Error handling.

Security checks.

Testing.

Deployment.

Production configuration.

96. MVP CORE WORKFLOW

The complete MVP workflow should be:

Customer creates order.

Customer uploads file.

System processes file.

Customer selects printing requirements.

System calculates price.

Customer confirms order.

Payment is recorded.

Order enters production.

System creates print job.

Allocation engine checks suitable printers.

System assigns printer.

Operator receives job.

Operator starts printing.

Printer processes job.

System tracks progress.

If printer fails, job can be paused or reassigned.

If page limit is reached, allocation can move future work to another printer.

When printing finishes, job is completed.

Order moves to quality check if enabled.

Order becomes ready.

Customer receives notification.

Order is completed after pickup or final fulfilment.

97. CORE SUCCESS CRITERIA

The MVP is successful when a real printing business can complete the main workflow without needing multiple disconnected systems.

A staff member should be able to:

Create a customer.

Create an order.

Upload a file.

Select printing requirements.

Calculate price.

Assign the job.

Print the job.

Handle a printer becoming unavailable.

Move work to another printer.

Track paper availability.

Complete the order.

View the order history.

98. NON FUNCTIONAL REQUIREMENTS

Performance:

Normal application pages should load quickly under normal business usage.

Reliability:

Orders must not disappear because a background worker fails.

Scalability:

The system should support adding businesses and printers without redesigning the core architecture.

Security:

Tenant isolation and authorization must be enforced server side.

Maintainability:

Business logic should be separated from UI logic.

Observability:

Important system operations should be logged.

99. DATA CONSISTENCY

The database should be the source of truth for:

Orders.

Payments.

Inventory.

Printer configuration.

Users.

Business settings.

Redis should not be the only location containing critical business state.

100. CONCURRENCY

The system must handle two users attempting to modify the same job.

The application should prevent invalid state transitions.

Allocation must avoid assigning one job to multiple printers simultaneously.

Inventory updates must prevent incorrect stock calculations from concurrent operations.

101. BACKGROUND PROCESSING

Long-running operations should use background workers.

Examples:

File processing.

Print allocation.

Notification sending.

Inventory alerts.

Report generation.

102. API SECURITY

Every protected API request must verify authentication and authorization.

The server must not trust permissions supplied by the client.

Object IDs alone must not grant access.

103. DATABASE SECURITY

Database access should use least privilege.

Production credentials should be separate from development credentials.

Backups should be configured.

104. BACKUPS

Critical application data should have automated backups.

Recovery procedures should be documented before production launch.

105. TESTING

The MVP should include tests for:

Authentication.

Authorization.

Tenant isolation.

Order creation.

File access.

Pricing.

Printer allocation.

Page limits.

Queue behavior.

Inventory updates.

Order status changes.

Payment status.

Notifications.

Reassignment.

Concurrent allocation.

106. ACCEPTANCE TEST

Scenario 1

Create a customer.

Create an order.

Upload a PDF.

Select A4 black and white.

Confirm the order.

Expected result:

The order appears in the production queue.

Scenario 2

Two printers support the required job.

One printer is busy.

Expected result:

The allocation system can select the eligible printer according to the configured rule.

Scenario 3

A printer reaches its configured page limit.

Expected result:

The printer is excluded from automatic allocation when page limit enforcement is enabled.

Scenario 4

Page limit enforcement is disabled.

Expected result:

The page limit does not block automatic allocation.

Scenario 5

A printer becomes unavailable.

Expected result:

Waiting eligible jobs can be reconsidered for another suitable printer.

Scenario 6

No compatible printer is available.

Expected result:

The job remains visible as blocked and displays the reason.

Scenario 7

A user from Business A attempts to access a file belonging to Business B.

Expected result:

Access is denied.

Scenario 8

A product price changes after an order is confirmed.

Expected result:

The confirmed order retains its original price.

107. UI PRINCIPLES

The interface should be simple.

The most important information should be visible without unnecessary navigation.

Production screens should emphasize:

Current jobs.

Priority.

Printer status.

Queue status.

Errors.

Required action.

Customer screens should emphasize:

Order creation.

Price.

Order status.

Files.

Notifications.

Business owner screens should emphasize:

Orders.

Revenue.

Production.

Printers.

Inventory.

Problems requiring attention.

108. ORDER SCREEN

The order screen should contain:

Order information.

Customer.

Files.

Printing specifications.

Price.

Payment.

Current status.

Print jobs.

Assigned printer.

Assigned operator.

Activity history.

Actions allowed by the current user.

109. PRINTER SCREEN

The printer screen should contain:

Printer name.

Status.

Capabilities.

Current job.

Queue.

Page usage.

Configured page limit.

Remaining allowance.

Paper availability.

Errors.

Actions.

110. QUEUE SCREEN

The queue screen should make it easy to understand:

What is waiting.

What is printing.

What is blocked.

What is paused.

What is completed.

Jobs should be sortable and filterable.

111. NOTIFICATION CENTER

Users should have a notification center.

Unread notifications should be clearly identified.

Users should be able to open the related order, printer, inventory item, or other object.

112. SEARCH AND NAVIGATION

The main navigation should remain consistent.

Users should not lose their place when moving between related records.

For example, opening a print job from an order should allow the user to return to that order easily.

113. PLATFORM EXTENSIBILITY

The system should be designed around modules.

Potential future modules:

AI file preparation.

Automated document correction.

Advanced print optimization.

Supplier marketplace.

Delivery marketplace.

Accounting.

Subscription management.

Customer loyalty.

Marketing.

Advanced analytics.

Predictive printer maintenance.

114. FUTURE AI FEATURES

AI can later assist with:

Document classification.

Print setting suggestions.

File quality detection.

Duplicate order detection.

Print cost optimization.

Demand forecasting.

Inventory forecasting.

Customer support.

Automated issue explanations.

AI should remain separate from the core transaction system.

115. SUBSCRIPTION MODEL

The platform can later support subscription plans for printing businesses.

Possible billing dimensions:

Number of printers.

Number of users.

Monthly orders.

Storage.

Automation features.

Advanced reporting.

Supplier features.

The billing system is not required for the initial MVP unless specifically included.

116. MULTI LOCATION SUPPORT

A future business can have multiple branches.

Each branch can have:

Printers.

Operators.

Inventory.

Orders.

Customers.

The business can view all branches from a central account.

117. BRANCH ALLOCATION

Future allocation rules can restrict a job to a particular branch.

For example:

Customer pickup branch.

Printer availability.

Inventory availability.

Production capability.

118. DATA RETENTION

The platform should allow configurable retention policies.

Files can have a different retention period from order records.

Deleting a file should not automatically delete the business transaction record.

119. FILE DELETION

File deletion should be controlled.

The system should verify authorization before deletion.

Important file deletion events should be audited.

120. FINAL MVP ARCHITECTURE

Recommended high level structure:

Frontend

Responsive web application.

Backend

API based application.

Database

Relational database.

Object Storage

Encrypted file storage.

Redis

Cache, queue, locks, and temporary state.

Workers

Background processing.

Printer Integration Layer

Communication between platform and local printers.

Notification Layer

Email and future messaging providers.

121. CORE SYSTEM RELATIONSHIPS

Business owns Users.

Business owns Customers.

Business owns Orders.

Order belongs to Customer.

Order contains Files.

Order contains Order Items.

Order creates Print Jobs.

Print Job belongs to Printer Queue.

Print Job can be assigned to Printer.

Print Job can be assigned to Operator.

Business owns Printers.

Business owns Inventory.

Business owns Products.

Business owns Suppliers.

Payments belong to Orders.

Notifications belong to Users and relevant business objects.

Audit Logs belong to the relevant business context.

122. PRODUCT PRINCIPLE

Print Automated should automate routine printing operations while keeping authorized staff in control.

Automation should be configurable.

Manual intervention should always be available to authorized users.

Every important automated decision should be traceable.

123. DEFINITION OF DONE FOR MVP

The MVP is considered complete when:

A business can create an account.

An owner can create users.

Roles restrict access correctly.

A customer can be created.

An order can be created.

A file can be uploaded securely.

The system can process the file.

Printing requirements can be selected.

The price can be calculated.

An order can be confirmed.

A print job can be created.

Printers can be configured.

Printer capabilities can be stored.

Jobs can enter a queue.

Jobs can be assigned manually.

Jobs can be assigned automatically.

Operators can receive jobs.

Page limits can be enabled.

Page limits can be disabled.

Jobs can be reassigned.

Inventory can be tracked.

Paper availability can affect allocation.

Notifications can be generated.

Audit logs are recorded.

Business data is isolated.

Files are protected.

The system can handle printer failure states.

The core workflow can be tested from order creation through completion.

124. MASTER PRODUCT RULE

The product must always preserve the relationship between the customer order and the actual production work.

An order is the commercial transaction.

A print job is the production task.

A printer is the production resource.

An operator is the person responsible for production.

Inventory represents physical resources.

The allocation system connects production tasks to available resources.

This separation should remain part of the core architecture as the platform grows.

END OF MASTER PRD
