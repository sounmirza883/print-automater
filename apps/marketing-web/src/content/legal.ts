export type LegalTable = {
  caption: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
};

export type LegalSection = {
  id: string;
  title: string;
  paragraphs?: readonly string[];
  bullets?: readonly string[];
  table?: LegalTable;
  after?: readonly string[];
};

export type LegalDoc = {
  slug: string;
  title: string;
  eyebrow: string;
  description: string;
  lede: string;
  lastUpdated: string;
  sections: readonly LegalSection[];
};

export const LEGAL_NOTICE = "Template draft for review by legal counsel before launch";
export const LEGAL_LAST_UPDATED = "25 September 2026";

export const privacyDoc: LegalDoc = {
  slug: "privacy",
  title: "Privacy policy",
  eyebrow: "Legal",
  description: "How Print Automated collects, uses and protects personal information.",
  lede: "This policy explains what personal information Print Automated handles, why, and the choices you have.",
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      id: "who-we-are",
      title: "Who we are",
      paragraphs: [
        "Print Automated provides an operating system for print shops: online ordering, an automatic print queue, printer connection, paper inventory and reporting. In this policy, “we” means Print Automated and “you” means a visitor, a customer placing an order, or a person working for a print shop that uses the service.",
        "[Legal entity name, registered address and registration number to be inserted before launch.]",
      ],
    },
    {
      id: "information-we-collect",
      title: "Information we collect",
      bullets: [
        "Account details: name, email address, phone number and password (stored only as a salted hash).",
        "Order details: the print options you choose, prices, order status and payment status. Card details are handled by the payment provider, not stored by us.",
        "Documents: files you upload to be printed, and basic file metadata such as name, size and type.",
        "Shop and staff details: business name, staff invitations, roles, printer names and settings.",
        "Activity records: audit-log entries for sensitive actions, and technical logs such as IP address, browser type and error reports.",
        "Messages you send to us, for example through support or by email.",
      ],
    },
    {
      id: "how-we-use-it",
      title: "How we use information",
      bullets: [
        "To provide the service: take orders, route jobs to printers, show order status and keep your shop running.",
        "To keep the service safe: scan uploaded files for malware, detect abuse, keep an audit trail and investigate incidents.",
        "To communicate with you about orders, your account, security and service changes.",
        "To improve reliability and product quality using aggregated or de-identified usage information.",
        "To meet legal obligations and to establish, exercise or defend legal claims.",
      ],
    },
    {
      id: "legal-bases",
      title: "Legal bases",
      paragraphs: [
        "Where data-protection law requires a legal basis, we rely on performance of a contract (providing the service you asked for), our legitimate interests (security, fraud prevention and product improvement), legal obligation, and consent where we ask for it.",
        "[Counsel to confirm the bases that apply in each launch jurisdiction.]",
      ],
    },
    {
      id: "documents",
      title: "Your documents",
      paragraphs: [
        "Documents you upload are treated as private. They are stored in private storage, are not publicly reachable, and are made available to the assigned print shop only through short-lived signed links. Files are scanned for malware and are encrypted in storage.",
        "Print shops receive only the documents belonging to jobs assigned to them. We do not read your documents except where needed to operate, secure or support the service, or where the law requires it.",
      ],
    },
    {
      id: "sharing",
      title: "Who we share information with",
      bullets: [
        "The print shop fulfilling your order, which receives the order details and document needed to print it.",
        "Service providers that help us run the service, such as hosting, storage, email and payment providers. See the sub-processor list on the data processing page.",
        "Authorities or advisers where required by law or to protect rights and safety.",
        "A successor business if Print Automated is involved in a merger or sale, with notice to you.",
      ],
      after: ["We do not sell personal information."],
    },
    {
      id: "retention",
      title: "How long we keep information",
      paragraphs: [
        "We keep information only as long as needed for the purposes above. Documents are subject to a retention period after which they are deleted; order and financial records are kept as long as accounting and legal rules require. See the data processing page for the retention overview.",
        "[Exact retention periods to be confirmed before launch.]",
      ],
    },
    {
      id: "your-rights",
      title: "Your choices and rights",
      paragraphs: [
        "Depending on where you live, you may have the right to access, correct, delete or export your personal information, to object to or restrict certain processing, and to withdraw consent. To exercise a right, email us at the address in the contact section. If you use Print Automated through a print shop, we may direct your request to that shop, which decides how its customers' data is used.",
      ],
    },
    {
      id: "security",
      title: "Security",
      paragraphs: [
        "We use encryption in transit and at rest, role-based access, tenant isolation, an audit log and regular backups. No system is perfectly secure. Read more on the security page.",
      ],
    },
    {
      id: "transfers",
      title: "International transfers",
      paragraphs: [
        "Information may be processed in countries other than your own. Where required, we use appropriate safeguards for those transfers. [Hosting regions and transfer mechanism to be confirmed.]",
      ],
    },
    {
      id: "cookies",
      title: "Cookies and similar technologies",
      paragraphs: [
        "This marketing site is a static site. The web application uses essential cookies or storage to keep you signed in. [Analytics and cookie-consent approach to be confirmed before launch.]",
      ],
    },
    {
      id: "children",
      title: "Children",
      paragraphs: [
        "The service is not directed at children, and we do not knowingly collect personal information from them.",
      ],
    },
    {
      id: "changes",
      title: "Changes to this policy",
      paragraphs: [
        "We will update this page when our practices change and change the date at the top. For material changes we will notify account holders.",
      ],
    },
    {
      id: "contact",
      title: "Contact",
      paragraphs: [
        "Questions or requests about privacy can be sent by email to the contact address on this site.",
      ],
    },
  ],
};

export const termsDoc: LegalDoc = {
  slug: "terms",
  title: "Terms of service",
  eyebrow: "Legal",
  description: "The terms that apply when you use Print Automated.",
  lede: "These terms govern your use of Print Automated. Please read them before creating an account.",
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      id: "agreement",
      title: "Agreement to these terms",
      paragraphs: [
        "By creating an account or using Print Automated you agree to these terms. If you use the service on behalf of a business, you confirm you have authority to bind that business.",
        "[Legal entity name and governing details to be inserted before launch.]",
      ],
    },
    {
      id: "the-service",
      title: "The service",
      paragraphs: [
        "Print Automated provides software for print shops and their customers: online ordering, a production queue, printer allocation, a printer agent, paper inventory and reporting. Features may change over time, and some listed features may be in development.",
      ],
    },
    {
      id: "accounts",
      title: "Accounts and roles",
      bullets: [
        "Keep your credentials confidential and tell us promptly about any unauthorised use.",
        "Shop owners are responsible for the staff they invite and for the roles they assign.",
        "Provide accurate information and keep it up to date.",
      ],
    },
    {
      id: "customers-and-shops",
      title: "Customers and print shops",
      paragraphs: [
        "When a customer places an order, the contract for printing is between the customer and the print shop. Print Automated provides the platform and is not the printer of the goods, unless we say so in writing. Print shops are responsible for the quality, pricing, fulfilment and lawful content of the work they accept.",
      ],
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      paragraphs: ["You agree not to:"],
      bullets: [
        "Upload unlawful content, malware, or material you do not have the right to print.",
        "Attempt to access another shop's data, probe or disrupt the service, or bypass security controls.",
        "Circumvent the printer agent's outbound-only connection to expose printers to the public internet.",
        "Resell or sublicense the service except as we expressly allow.",
      ],
    },
    {
      id: "your-content",
      title: "Your content",
      paragraphs: [
        "You keep ownership of documents and data you submit. You give us a limited licence to host, process, scan and transmit them solely to operate and secure the service and to deliver the print jobs you request.",
      ],
    },
    {
      id: "fees",
      title: "Plans, fees and payment",
      paragraphs: [
        "Paid plans, prices and billing periods are shown at sign-up. Fees are charged in advance unless stated otherwise and are non-refundable except where required by law. We will give notice before changing prices. [Billing, tax and refund terms to be finalised.]",
      ],
    },
    {
      id: "availability",
      title: "Availability and support",
      paragraphs: [
        "We work to keep the service available and to recover interrupted jobs, but we do not guarantee uninterrupted operation. Printers, networks and third-party providers are outside our control. [Service-level commitments, if any, to be defined.]",
      ],
    },
    {
      id: "privacy-and-data",
      title: "Privacy and data processing",
      paragraphs: [
        "Our privacy policy explains how we handle personal information. Where we process personal data on behalf of a print shop, the data processing page describes the roles and responsibilities.",
      ],
    },
    {
      id: "suspension-termination",
      title: "Suspension and termination",
      paragraphs: [
        "You can stop using the service at any time. We may suspend or end access if you breach these terms, put the service or others at risk, or fail to pay. On termination, your data is handled as described on the data processing page.",
      ],
    },
    {
      id: "warranties",
      title: "Disclaimers",
      paragraphs: [
        "The service is provided “as is” and “as available” to the extent permitted by law. We do not promise the service will be error-free or that it will fit every purpose.",
      ],
    },
    {
      id: "liability",
      title: "Limitation of liability",
      paragraphs: [
        "To the extent permitted by law, we are not liable for indirect or consequential losses, and our total liability is limited to the amount set out in the final terms. [Cap and carve-outs to be settled by counsel.]",
      ],
    },
    {
      id: "changes",
      title: "Changes to these terms",
      paragraphs: [
        "We may update these terms. We will change the date above and notify account holders of material changes. Continued use after a change means you accept it.",
      ],
    },
    {
      id: "law",
      title: "Governing law and disputes",
      paragraphs: [
        "[Governing law, venue and dispute-resolution process to be inserted by counsel.]",
      ],
    },
    {
      id: "contact",
      title: "Contact",
      paragraphs: ["Questions about these terms can be sent to the contact address on this site."],
    },
  ],
};

export const securityDoc: LegalDoc = {
  slug: "security",
  title: "Security",
  eyebrow: "Trust",
  description:
    "How Print Automated protects files, people and printers: encryption, private storage, virus scanning, access control, audit logging, backups and recovery.",
  lede: "Files, people and printers are protected at every step. This page describes the controls built into the product and how to report a problem.",
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      id: "data-protection",
      title: "Data protection",
      paragraphs: [
        "Customer documents are the most sensitive thing on the platform, so the design starts there.",
      ],
      bullets: [
        "In transit: connections between browsers, apps, the printer agent and the platform use TLS.",
        "At rest: files and records are stored encrypted. Document encryption keys are kept separate from the database.",
        "Private storage: documents are never publicly reachable. Access is granted through short-lived signed links, only to the shop a job is assigned to.",
        "Virus scanning: every uploaded file is scanned, and infected files are blocked before they can reach a printer or a staff member.",
        "Retention: documents are deleted after a configurable retention period.",
      ],
    },
    {
      id: "access-control",
      title: "Access control and tenant isolation",
      bullets: [
        "Role-based access: owners, managers, counter staff and operators see and change only what their role allows.",
        "Tenant isolation: each shop's data is kept separate from every other shop's. A shop sees only documents belonging to jobs assigned to it.",
        "Audit log: sensitive actions such as changing prices, inviting users or reprinting a job are recorded with who, what and when, and entries cannot be edited.",
        "Authorised printing only: the printer agent prints only jobs the platform has authorised for that shop and device.",
      ],
    },
    {
      id: "printer-connection",
      title: "Printer connection",
      paragraphs: [
        "The printer agent runs on a computer at the shop and connects outward to the platform. It needs no inbound ports and never exposes your printers to the internet. The platform cannot reach into your network; the agent asks for work and reports back.",
      ],
    },
    {
      id: "reliability",
      title: "Backups and reliability",
      bullets: [
        "Regular backups of the database so a mistake or an outage does not cost you your history.",
        "Queue recovery: jobs interrupted by a restart or a printer problem are recovered rather than lost.",
        "Duplicate-print protection: a job is not printed twice by accident, and uncertain states are flagged for a person to resolve.",
        "Optional failover: if you opt in, a job can move to another suitable printer when one goes offline.",
      ],
    },
    {
      id: "disclosure",
      title: "Responsible disclosure",
      paragraphs: [
        "If you believe you have found a vulnerability, please email us with a description and steps to reproduce. We ask that you give us reasonable time to fix the issue before sharing it publicly, avoid accessing other people's data, and avoid degrading the service. We will acknowledge your report, keep you informed and credit you if you wish.",
        "This is a good-faith process. It is not a bug-bounty programme and does not offer payment.",
      ],
    },
    {
      id: "not-claimed",
      title: "What we do not claim",
      paragraphs: [
        "Print Automated has not been independently certified against a formal security or compliance standard. We describe the controls we have built; we do not claim audits or certifications we do not hold. If you need specific assurances for procurement, contact us.",
      ],
    },
  ],
};

export const dpaDoc: LegalDoc = {
  slug: "data-processing",
  title: "Data processing overview",
  eyebrow: "Legal",
  description:
    "An overview of Print Automated's role as data processor: controller and processor roles, sub-processors, retention, deletion and transfers.",
  lede: "This page summarises how personal data is processed for print shops that use Print Automated. A signed data processing agreement is available on request.",
  lastUpdated: LEGAL_LAST_UPDATED,
  sections: [
    {
      id: "scope",
      title: "Scope",
      paragraphs: [
        "This overview applies when a print shop (the customer) uses Print Automated to handle personal data about its own customers and staff. It is a summary, not a signed agreement.",
      ],
    },
    {
      id: "roles",
      title: "Roles: controller and processor",
      table: {
        caption: "Roles by type of data",
        headers: ["Data", "Print shop", "Print Automated"],
        rows: [
          ["Customer order details and documents", "Controller", "Processor"],
          ["Staff accounts and roles", "Controller", "Processor"],
          ["Shop settings, prices and inventory", "Controller", "Processor"],
          ["Platform account, billing and security logs", "Recipient", "Controller"],
        ],
      },
      after: [
        "As processor, Print Automated processes personal data only on the shop's documented instructions, which are the shop's use of the service and its settings.",
      ],
    },
    {
      id: "processing-details",
      title: "Details of processing",
      bullets: [
        "Purpose: providing online ordering, job routing, printing, inventory and reporting.",
        "Data subjects: the shop's customers and staff.",
        "Data types: names, contact details, order and payment status, uploaded documents, activity logs.",
        "Duration: for as long as the shop uses the service, plus the periods below.",
      ],
    },
    {
      id: "security-measures",
      title: "Security measures",
      paragraphs: [
        "Measures include encryption in transit and at rest, private file storage with short-lived signed links, virus scanning, role-based access, tenant isolation, audit logging and regular backups. See the security page for detail.",
      ],
    },
    {
      id: "sub-processors",
      title: "Sub-processors",
      paragraphs: [
        "Print Automated may use sub-processors to deliver the service. The list below is a placeholder and must be completed before launch.",
      ],
      table: {
        caption: "Sub-processors (placeholder)",
        headers: ["Purpose", "Provider", "Location"],
        rows: [
          ["Application hosting", "[To be confirmed]", "[Region]"],
          ["File and object storage", "[To be confirmed]", "[Region]"],
          ["Database hosting and backups", "[To be confirmed]", "[Region]"],
          ["Payment processing", "[To be confirmed]", "[Region]"],
          ["Transactional email", "[To be confirmed]", "[Region]"],
        ],
      },
      after: [
        "We will notify customers before adding or replacing a sub-processor. [Notice period to be confirmed.]",
      ],
    },
    {
      id: "retention",
      title: "Data retention",
      table: {
        caption: "Retention overview (placeholder periods)",
        headers: ["Data", "Retention"],
        rows: [
          [
            "Uploaded documents",
            "Configurable retention period, then deleted [default to be confirmed]",
          ],
          [
            "Order and payment records",
            "As required by accounting and legal rules [to be confirmed]",
          ],
          ["Audit log", "[To be confirmed]"],
          ["Backups", "Rotated on a fixed schedule [to be confirmed]"],
        ],
      },
    },
    {
      id: "deletion",
      title: "Return and deletion",
      paragraphs: [
        "On request or when the agreement ends, we delete or return personal data, except where the law requires us to keep it. Deleted data is removed from backups as they rotate out. [Timelines to be confirmed.]",
      ],
    },
    {
      id: "requests",
      title: "Data subject requests and incidents",
      bullets: [
        "If we receive a request from one of a shop's customers, we forward it to the shop and help the shop respond.",
        "We will notify the shop without undue delay after becoming aware of a personal-data breach affecting its data.",
      ],
    },
    {
      id: "transfers",
      title: "International transfers",
      paragraphs: [
        "Personal data may be processed outside the shop's country. Where required, transfers rely on an approved mechanism. [Hosting regions and transfer mechanism to be confirmed.]",
      ],
    },
    {
      id: "contact",
      title: "Contact",
      paragraphs: [
        "To request a signed agreement or ask a question, email the contact address on this site.",
      ],
    },
  ],
};
