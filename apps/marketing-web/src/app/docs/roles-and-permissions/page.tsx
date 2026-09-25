import type { Metadata } from "next";
import { Callout, DocPage, TableScroll } from "@/components/docs";
import type { TocItem } from "@/components/docs";

export const metadata: Metadata = {
  title: "Roles and permissions",
  description:
    "The staff roles in Print Automated, the permission catalogue, and which role holds which permission.",
  alternates: { canonical: "/docs/roles-and-permissions" },
};

const toc: TocItem[] = [
  { id: "roles", label: "Roles" },
  { id: "matrix", label: "Permission matrix" },
  { id: "how-enforced", label: "How it is enforced" },
];

const roles: [string, string, string][] = [
  [
    "SHOP_OWNER",
    "Owner",
    "Everything, including business settings such as currency, tax, hours and notifications.",
  ],
  [
    "SHOP_MANAGER",
    "Manager",
    "Everything an owner can do except business settings. Runs the floor, staff, prices and automation.",
  ],
  ["SHOP_COUNTER", "Counter", "Front of house: view, create and edit orders, and manage delivery."],
  [
    "OPERATOR",
    "Operator",
    "Production floor: view orders, assign, pause and resume jobs, record failures, quality checks, view stock.",
  ],
  [
    "PRINTER_MANAGER",
    "Printer manager",
    "Owns the printer fleet: manage printers, assign and pause jobs, reprint, quality checks, view stock.",
  ],
  [
    "CUSTOMER",
    "Customer",
    "Self-registered account that places its own orders. Holds no shop permissions.",
  ],
  [
    "ADMIN",
    "Platform admin",
    "Platform-level, for Print Automated staff only, via dedicated /v1/admin routes.",
  ],
  ["SUPPLIER", "Supplier", "Reserved. Holds no permissions today."],
];

// Column order: Owner, Manager, Counter, Operator, Printer manager.
const matrix: [string, string, [boolean, boolean, boolean, boolean, boolean]][] = [
  ["VIEW_ORDERS", "See orders and customers", [true, true, true, true, true]],
  ["CREATE_ORDERS", "Create counter orders", [true, true, true, false, false]],
  ["EDIT_ORDERS", "Accept, reject, ready, complete, retry", [true, true, true, false, false]],
  ["CANCEL_ORDERS", "Cancel orders", [true, true, false, false, false]],
  ["MANAGE_DELIVERY", "Delivery details and status", [true, true, true, false, false]],
  ["ASSIGN_JOBS", "Assign and reassign jobs", [true, true, false, true, true]],
  ["PAUSE_JOBS", "Pause and resume jobs", [true, true, false, true, true]],
  ["RECORD_JOB_FAILURE", "Record why a job failed", [true, true, false, true, true]],
  ["QUALITY_CHECK", "Record a quality verdict", [true, true, false, true, true]],
  ["REPRINT_JOBS", "Create reprints", [true, true, false, false, true]],
  [
    "MANAGE_PRINTERS",
    "Register, edit, disable printers; pair agents",
    [true, true, false, false, true],
  ],
  ["VIEW_INVENTORY", "See stock and movements", [true, true, false, true, true]],
  ["MANAGE_INVENTORY", "Change stock, purchase orders", [true, true, false, false, false]],
  ["MANAGE_SUPPLIERS", "Suppliers and supplier products", [true, true, false, false, false]],
  ["MANAGE_PRICES", "Products and pricing rules", [true, true, false, false, false]],
  ["VIEW_REPORTS", "Reports", [true, true, false, false, false]],
  ["MANAGE_USERS", "Add, remove, change staff roles", [true, true, false, false, false]],
  ["VIEW_SETTINGS", "Read settings and printer rules", [true, true, false, false, false]],
  ["MANAGE_AUTOMATION", "Automation toggles and printer rules", [true, true, false, false, false]],
  ["MANAGE_SETTINGS", "Business details (owner only)", [true, false, false, false, false]],
];

const cols = ["Owner", "Manager", "Counter", "Operator", "Printer manager"];

export default function RolesPage() {
  return (
    <DocPage
      href="/docs/roles-and-permissions"
      title="Roles and permissions"
      lede="Every staff member has one role in a business. Roles are just bundles of permissions, and the server checks the permission on every request."
      toc={toc}
    >
      <h2 id="roles">Roles</h2>
      <TableScroll label="Roles" minWidth="min-w-[36rem]">
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Called</th>
            <th scope="col">What it is for</th>
          </tr>
        </thead>
        <tbody>
          {roles.map(([code, name, desc]) => (
            <tr key={code}>
              <th scope="row" className="font-mono text-xs">
                {code}
              </th>
              <td>{name}</td>
              <td>{desc}</td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
      <p>
        Only Owner, Manager, Counter, Operator and Printer manager can be assigned to staff (
        <code>POST /v1/shop/staff</code>, <code>PATCH /v1/shop/staff/:id/role</code>).
      </p>

      <h2 id="matrix">Permission matrix</h2>
      <p>A tick means the role holds the permission.</p>
      <TableScroll label="Permission matrix" minWidth="min-w-[48rem]">
        <thead>
          <tr>
            <th scope="col">Permission</th>
            <th scope="col">Allows</th>
            {cols.map((c) => (
              <th key={c} scope="col" className="text-center">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map(([perm, desc, has]) => (
            <tr key={perm}>
              <th scope="row" className="font-mono text-xs">
                {perm}
              </th>
              <td>{desc}</td>
              {has.map((h, i) => (
                <td key={cols[i]} className="text-center">
                  {h ? (
                    <>
                      <span aria-hidden="true">✓</span>
                      <span className="sr-only">Yes</span>
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true" className="text-ink-400">
                        –
                      </span>
                      <span className="sr-only">No</span>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </TableScroll>

      <h2 id="how-enforced">How it is enforced</h2>
      <ul>
        <li>
          <strong>Server side only.</strong> Hiding a button in an app is a convenience, never the
          control. Each shop route lists the roles allowed and the permission required.
        </li>
        <li>
          <strong>Scoped to the business.</strong> Shop routes take a <code>shopId</code> (in the
          body or query) or resolve one from the record you address, and check that you are active
          staff of that business. A valid token for another business gets 403.
        </li>
        <li>
          <strong>Audited.</strong> Sensitive actions such as sign-in, pairing-code issue and
          settings changes are written to an audit log.
        </li>
      </ul>
      <Callout title="Automation vs. business settings">
        <p>
          Managers can switch automation off and run the floor by hand (
          <code>MANAGE_AUTOMATION</code>
          ), but business-level configuration (<code>MANAGE_SETTINGS</code>) stays with the owner.
        </p>
      </Callout>
    </DocPage>
  );
}
